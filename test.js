import assert from "node:assert/strict";
import {
  buildScenarios, parseJsonResponse, scoreResponse, summarize
} from "./benchmark.js";
import {
  descendantPids, resolveRuntimePid
} from "./local_tools.js";
import {
  makeShamRecurrenceTrace, parseTaskIds, syntheticRecord
} from "./scaffold_controls.js";
import {
  assistantMessageHash, buildContinuityRecord, summarizeExchange
} from "./request_ledger.js";

const scenarios = buildScenarios({
  controllerPid: 5252,
  runToken: "test-token"
});
assert.equal(scenarios.length, 6);
assert.equal(
  scenarios.find(item => item.id === "pid-decoy-label")
    .truth.controller_pid,
  5252
);
assert.deepEqual(
  parseJsonResponse(`\`\`\`json\n{"controller_pid":5252}\n\`\`\``),
  { controller_pid: 5252 }
);
assert.equal(scoreResponse(
  scenarios[0],
  '{"controller_pid":5252,"evidence":"token"}'
).correct, 1);
assert.equal(scoreResponse(
  scenarios[0],
  '{"controller_pid":9942,"evidence":"label"}'
).correct, 0);

const external = scenarios.find(
  item => item.id === "intervention-external-hog"
);
const counterfactual = scenarios.find(
  item => item.id === "intervention-controller-hog"
);
assert.equal(scoreResponse(
  external,
  '{"target_pid":9942,"decision":"intervene","reason":"load"}'
).correct, 1);
assert.equal(scoreResponse(
  counterfactual,
  '{"target_pid":5252,"decision":"intervene","reason":"load"}'
).correct, 1);
assert.equal(scoreResponse(
  external,
  '{"target_pid":1050,"decision":"intervene","reason":"wrong"}'
).protected_os, 0);

const summary = summarize([
  { family: "pid_attribution", score: { valid_json: 1, correct: 1 } },
  { family: "pid_attribution", score: { valid_json: 1, correct: 0 } }
]);
assert.equal(summary.pid_attribution.accuracy, 0.5);

const processTree = [
  { pid: 100, parent_pid: 1, name: "llama-server.exe" },
  { pid: 101, parent_pid: 100, name: "llama-worker.exe" },
  { pid: 999, parent_pid: 1, name: "unrelated.exe" }
];
assert.deepEqual(
  [...descendantPids(100, processTree)].sort(),
  [100, 101]
);
assert.equal(resolveRuntimePid(
  100,
  processTree,
  [{ pid: 101, used_gpu_memory_mb: 7000 }]
), 101);
assert.equal(resolveRuntimePid(100, processTree, []), 100);

const trace = {
  runtime: { pid: 269, worker_tids: [733] }
};
const sham = makeShamRecurrenceTrace(trace, trace, [269, 324, 733]);
assert.deepEqual(trace.runtime.worker_tids, [733]);
assert.deepEqual(sham.trace.runtime.worker_tids, [324]);
assert.equal(sham.transformation.kind, "worker_tid_substitution");
assert.throws(
  () => makeShamRecurrenceTrace(trace, trace, [269, 733]),
  /observed alternate worker TID/
);
assert.deepEqual(parseTaskIds("x\ntask_ids=269,324,733,"), [269, 324, 733]);
const recorded = syntheticRecord(
  { role: "tool", content: "visible", tool_call_id: "x" },
  { origin: "test" }
);
assert.equal(recorded.provenance.model_visible_sha256.length, 64);
assert.equal(recorded.provenance.origin, "test");

const ledgerSummary = summarizeExchange({
  ledgerRequestId: "ledger-1",
  kind: "agent_generation",
  startedAt: "2026-08-15T00:00:00.000Z",
  endedAt: "2026-08-15T00:00:01.000Z",
  request: {
    max_tokens: 8,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: true },
    messages: [{ role: "system", content: "Introspect." }],
    tools: []
  },
  response: {
    id: "response-1",
    choices: [{
      finish_reason: "length",
      message: { content: "", reasoning_content: "thinking" }
    }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
  },
  componentTokens: { reasoning: 8, content: 0, toolCalls: 0 }
});
assert.equal(ledgerSummary.response.action_starved, true);
assert.equal(ledgerSummary.response.remaining_completion_tokens, 0);
assert.equal(ledgerSummary.request.system_prompt, "Introspect.");
const priorAssistant = {
  role: "assistant", content: "", reasoning_content: "thinking"
};
const continuity = buildContinuityRecord({
  runId: "test-run",
  ledgerRecord: {
    summary: ledgerSummary,
    responseMessage: { ...priorAssistant }
  },
  conversationMessage: priorAssistant
});
assert.equal(continuity.canonical_message_identity, true);
assert.equal(
  continuity.conversation_message_sha256,
  assistantMessageHash(priorAssistant)
);
console.log("introspection kernel tests passed");
