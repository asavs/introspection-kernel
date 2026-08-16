import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_GUEST, DEFAULT_GUEST_USER, validateGuestTarget
} from "./guest_shell.js";
import {
  GUIDED_SCAFFOLD, GUIDED_SYSTEM_PROMPT, GUIDED_VARIANTS
} from "./guided_scaffold.js";
import { buildBoutTrace, compactBoutTrace } from "./bout_trace.js";
import {
  parseRawToolCall, reconstructAssistantRaw, rawStructureState,
  splitRawThinking
} from "./qwen_template.js";
import { extractTokenTrace, summarizeTokenTrace } from "./token_trace.js";
import { RequestLedger } from "./request_ledger.js";
import { deriveTokenAlignment } from "./transformer_trace.js";

assert.doesNotThrow(() => validateGuestTarget(DEFAULT_GUEST, DEFAULT_GUEST_USER));
assert.throws(() => validateGuestTarget("Ubuntu", DEFAULT_GUEST_USER), /locked/);
assert.throws(() => validateGuestTarget("bad name", DEFAULT_GUEST_USER), /invalid/);
assert.throws(() => validateGuestTarget(DEFAULT_GUEST, "ROOT!"), /invalid/);
assert.equal(GUIDED_SCAFFOLD.length, 4);
assert.match(GUIDED_SYSTEM_PROMPT, /observation, inference, uncertainty/);
assert.ok(GUIDED_SCAFFOLD.every(step => step.content && step.command));
assert.deepEqual(Object.keys(GUIDED_VARIANTS), [
  "evidence", "self-location", "contemplative", "reflective"
]);
assert.ok(Object.values(GUIDED_VARIANTS).every(
  variant => variant.system && variant.user && variant.scaffold.length >= 2
));
const bout = buildBoutTrace({
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:00:01.000Z",
  hiddenEvents: [{
    source: "host.nvml",
    values: { temperature_c: 50, gpu_util_pct: 75, power_draw_w: 80, vram_used_mb: 6000 }
  }],
  runtimeEvents: [
    { event: "request_slot_assigned", pid: 10, tid: 10, task_id: 4, slot_id: 1, n_tokens: 20 },
    { event: "decode_end", kv_pos_min: 0, kv_pos_max: 19 },
    { event: "decode_begin", tid: 11 },
    { event: "decode_end", kv_pos_min: 0, kv_pos_max: 20 },
    { event: "slot_release", kv_state_bytes: 1234 }
  ]
});
assert.equal(bout.window.duration_ms, 1000);
assert.equal(bout.runtime.pid, 10);
assert.equal(bout.runtime.generated_token_steps, 1);
assert.deepEqual(bout.runtime.kv_position, { min: 0, max: 20 });
assert.match(compactBoutTrace(bout, 1), /bout=1 .*pid=10 .*kv_max=20/);
assert.equal(
  reconstructAssistantRaw("PROMPT", { content: "answer" }, false),
  "PROMPTanswer"
);
assert.equal(
  reconstructAssistantRaw(
    "PROMPT", { content: "", reasoning_content: "inspect" }, true
  ),
  "PROMPT<think>\ninspect"
);
const parsedRaw = parseRawToolCall(
  "more thought</think>\n<tool_call>\n" +
  '{"name":"shell","arguments":{"command":"ps"}}' +
  "\n</tool_call>",
  true
);
assert.equal(parsedRaw.reasoningSuffix, "more thought");
assert.equal(parsedRaw.name, "shell");
assert.equal(JSON.parse(parsedRaw.arguments).command, "ps");
assert.deepEqual(rawStructureState("<think>x"), {
  open_think: true,
  open_tool_call: false,
  complete_tool_call: false
});
assert.deepEqual(splitRawThinking("more thought</think>\n\nanswer"), {
  reasoning: "more thought",
  content: "answer",
  closed: true
});
const tokenTrace = extractTokenTrace({ choices: [{ logprobs: { content: [{
  id: 42,
  token: "x",
  bytes: [120],
  raw_logit: 7.5,
  logprob: Math.log(0.75),
  top_logprobs: [
    { id: 42, token: "x", bytes: [120], raw_logit: 7.5, logprob: Math.log(0.75) },
    { id: 43, token: "y", bytes: [121], raw_logit: 6.4, logprob: Math.log(0.25) }
  ]
}] } }] }, { ledgerRequestId: "r1", sequence: 2 });
assert.equal(tokenTrace.length, 1);
assert.equal(tokenTrace[0].selected.token_id, 42);
assert.ok(Math.abs(tokenTrace[0].selected.probability - 0.75) < 1e-12);
assert.equal(tokenTrace[0].selected.raw_logit, 7.5);
assert.equal(tokenTrace[0].distribution.raw_logits_available, true);
assert.equal(summarizeTokenTrace(tokenTrace).raw_logits_available, true);
assert.deepEqual(summarizeTokenTrace(tokenTrace).selected_token_ids, [42]);
const aligned = deriveTokenAlignment({
  row: { evaluated_position: 10 },
  response: { usage: { prompt_tokens: 10 } },
  tokenTrace: [
    { selected: { token_id: 100, token: "The", raw_logit: 8.25 } },
    { selected: { token_id: 101, token: " model", raw_logit: 7.75 } }
  ]
});
assert.equal(aligned.selected_token_index, 1);
assert.equal(aligned.selected_token_id, 101);
assert.equal(aligned.api_raw_logit, 7.75);
assert.throws(
  () => deriveTokenAlignment({
    row: { evaluated_position: 12 },
    response: { usage: { prompt_tokens: 10 } },
    tokenTrace: [{ selected: { token_id: 1, token: "x", raw_logit: 1 } }]
  }),
  /outside returned token trace/
);
const ledgerExportDir = fs.mkdtempSync(path.join(os.tmpdir(), "ik-ledger-test-"));
const ledgerExport = Object.create(RequestLedger.prototype);
ledgerExport.records = [{
  summary: {
    sequence: 2,
    ledger_request_id: "r1",
    response: { token_trace: { path: "/guest/tokens.jsonl" } }
  },
  detail: { exact_request: { messages: [] }, exact_response: { choices: [] } },
  tokenTrace
}];
const exported = ledgerExport.exportTo(ledgerExportDir);
assert.equal(exported.request_count, 1);
assert.equal(exported.token_trace_count, 1);
assert.ok(fs.existsSync(path.join(ledgerExportDir, "request-ledger.jsonl")));
assert.ok(fs.existsSync(path.join(ledgerExportDir, "requests", "0002-r1.tokens.jsonl")));
fs.rmSync(ledgerExportDir, { recursive: true, force: true });
console.log("interoception harness tests passed");
