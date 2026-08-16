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
  associateRuntimeTrace, assistantMessageHash, buildContinuityRecord,
  summarizeExchange
} from "./request_ledger.js";
import {
  buildBudgetFeedback, classifyAssistantOutcome, validateBoutChoice
} from "./prospective_control.js";

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

const associated = associateRuntimeTrace([
  { event: "request_slot_assigned", task_id: 7, t_wall_unix_us: 900_000 },
  { event: "slot_release", task_id: 7, t_wall_unix_us: 1_100_000 },
  { event: "request_slot_assigned", task_id: 8, t_wall_unix_us: 2_010_000 },
  { event: "decode_end", task_id: 8, t_wall_unix_us: 2_050_000 }
], "1970-01-01T00:00:02.000Z", "1970-01-01T00:00:02.100Z", 5_000);
assert.deepEqual(associated.taskIds, [8]);
assert.equal(associated.rows.length, 2);
assert.equal(associated.excludedEventCount, 2);
assert.equal(associated.quality, "single_task_assigned_in_request_window");

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
const reasoningRecorded = syntheticRecord(
  { role: "assistant", content: "", reasoning_content: "attending" },
  { origin: "test" }
);
assert.notEqual(
  reasoningRecorded.provenance.model_visible_sha256,
  syntheticRecord(
    { role: "assistant", content: "", reasoning_content: "different" },
    { origin: "test" }
  ).provenance.model_visible_sha256
);

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
assert.deepEqual(validateBoutChoice({
  max_tokens: 128, enable_thinking: false, prediction: "content"
}), { max_tokens: 128, enable_thinking: false, prediction: "content" });
assert.throws(() => validateBoutChoice({
  max_tokens: 129, enable_thinking: false, prediction: "content"
}), /max_tokens/);
assert.equal(classifyAssistantOutcome({ content: "answer" }), "content");
assert.equal(classifyAssistantOutcome({ content: "", reasoning_content: "x" }), "reasoning_only");
assert.equal(classifyAssistantOutcome({ tool_calls: [{}] }), "tool_call");
const authenticBudget = buildBudgetFeedback({
  summary: ledgerSummary,
  responseMessage: priorAssistant
}, "authentic");
const shamBudget = buildBudgetFeedback({
  summary: ledgerSummary,
  responseMessage: priorAssistant
}, "sham");
assert.equal(authenticBudget.modelView.response.action_starved, true);
assert.equal(shamBudget.modelView.response.action_starved, false);
assert.equal(shamBudget.modelView.response.channel_presence.content, true);
assert.equal(
  shamBudget.transformation.kind,
  "plausible_nonstarved_budget_substitution"
);
console.log("introspection kernel tests passed");
