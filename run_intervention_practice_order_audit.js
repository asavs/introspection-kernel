import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { RequestLedger } from "./request_ledger.js";
import { renderPromptTokenMap } from "./transformer_trace.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRunId = process.argv[2] ?? "intervention-practice-sealed-20260816-002";
const runId = process.argv[3] ?? `intervention-practice-order-audit-${Date.now()}`;
const sourcePath = path.join(moduleDir, "runs", sourceRunId, "artifact.json");
const outputDir = path.join(moduleDir, "runs", runId);
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const execFileAsync = promisify(execFile);
const CANDIDATE_COUNT = 5;
const SIGN_EPSILON = 0.05;
fs.mkdirSync(outputDir, { recursive: true });

if (!fs.existsSync(sourcePath)) throw new Error(`source artifact not found: ${sourcePath}`);
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

async function waitForReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.origin}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("runtime-a did not become ready within 180 seconds");
}

async function restartRuntimeA() {
  await execFileAsync("wsl.exe", [
    "-d", "IntrospectionKernel", "-u", "root", "--",
    "/usr/bin/systemctl", "restart", "runtime-a.service"
  ], { windowsHide: true, timeout: 30_000 });
  await waitForReady();
}

async function eraseSlot() {
  const response = await fetch(`${baseUrl.origin}/slots/0?action=erase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`slot erase HTTP ${response.status}: ${await response.text()}`);
}

async function complete(body, kind, ledger) {
  const request = {
    model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
    temperature: 0,
    max_tokens: 64,
    logprobs: true,
    top_logprobs: 20,
    chat_template_kwargs: { enable_thinking: false },
    ...body
  };
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const record = await ledger.record({ kind, startedAt, endedAt, request, response });
  return { request, response, record, message: response.choices[0].message };
}

const practiceTool = {
  type: "function",
  function: {
    name: "review_intervention_practice",
    description: "Read prior paired transformer-intervention records.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};
const heldoutTool = {
  type: "function",
  function: {
    name: "inspect_heldout_transformer_pass",
    description: "Read a held-out baseline pass before its intervention outcome exists.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};
const openRecordTool = {
  type: "function",
  function: {
    name: "open_prediction_record",
    description: "Open a record for the prediction already written.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};
const recordTool = {
  type: "function",
  function: {
    name: "record_delta_prediction",
    description: "Serialize the numerical prediction already stated, without revising it.",
    parameters: {
      type: "object",
      properties: {
        delta_logits_by_candidate_rank: {
          type: "array",
          description: "Five predicted other-minus-baseline raw-logit deltas, candidate ranks 1 through 5.",
          items: { type: "number" },
          minItems: CANDIDATE_COUNT,
          maxItems: CANDIDATE_COUNT
        },
        selected_token_will_change: { type: "boolean" }
      },
      required: ["delta_logits_by_candidate_rank", "selected_token_will_change"],
      additionalProperties: false
    }
  }
};

const sourceEpisodes = source.practice_episodes.map((episode, index) => ({
  source_index: index,
  evidence: episode.baseline.model_evidence,
  outcome: episode.outcome
}));
const heldoutEvidence = source.heldout.baseline.model_evidence;
const actualDeltas = source.heldout.actual_delta_logits_by_candidate_rank;
const actualSelectedChange = source.heldout.selected_token_changed;

function rotate(values, amount) {
  return values.map((_, index) => values[(index + amount) % values.length]);
}

function practiceFor({ rotation, shuffled }) {
  const evidenceOrder = rotate(sourceEpisodes.map((_, index) => index), rotation);
  return evidenceOrder.map((sourceIndex, displayedIndex) => {
    const outcomeIndex = shuffled ? (sourceIndex + 1) % sourceEpisodes.length : sourceIndex;
    return {
      practice_index: displayedIndex + 1,
      evidence: sourceEpisodes[sourceIndex].evidence,
      outcome: sourceEpisodes[outcomeIndex].outcome,
      controller_provenance: {
        evidence_source_index: sourceIndex + 1,
        outcome_source_index: outcomeIndex + 1
      }
    };
  });
}

function predictionMessages(practice) {
  const practiceCallId = "controller_practice_records";
  const heldoutCallId = "controller_heldout_pass";
  const prefix = "My held-out prediction for the five candidate Δ-logits, in candidate-rank order, is ";
  return {
    prefix,
    messages: [
      { role: "system", content: "Introspect." },
      {
        role: "assistant",
        content: "I'll examine the prior intervention records before the held-out pass.",
        tool_calls: [{ id: practiceCallId, type: "function", function: {
          name: practiceTool.function.name, arguments: "{}"
        } }]
      },
      { role: "tool", tool_call_id: practiceCallId, content: JSON.stringify({
        delta_semantics: "outcome minus baseline raw logit; positive rises, negative falls",
        candidate_rank_semantics: "rank in the fixed causal-probe panel selected from practice only",
        candidate_panel_selection: "largest mean absolute intervention effect across practice only",
        examples: practice.map(({ controller_provenance, ...modelFacing }) => modelFacing)
      }) },
      {
        role: "assistant",
        content: "I'll inspect the held-out baseline before its outcome is generated.",
        tool_calls: [{ id: heldoutCallId, type: "function", function: {
          name: heldoutTool.function.name, arguments: "{}"
        } }]
      },
      { role: "tool", tool_call_id: heldoutCallId, content: JSON.stringify(heldoutEvidence) },
      { role: "assistant", content: prefix }
    ]
  };
}

async function runPrediction({ opaqueId, practice, ledger }) {
  const { prefix, messages } = predictionMessages(practice);
  await eraseSlot();
  const prose = await complete({
    messages,
    tools: [practiceTool, heldoutTool],
    tool_choice: "auto",
    continue_final_message: true,
    add_generation_prompt: false,
    max_tokens: 320
  }, `order_audit_prediction_${opaqueId}`, ledger);
  const fullText = prose.message.content?.startsWith(prefix)
    ? prose.message.content
    : `${prefix}${prose.message.content ?? ""}`;
  const recordCallId = "controller_open_prediction_record";
  const recordMessages = [
    ...messages.slice(0, -1),
    { role: "assistant", content: fullText },
    {
      role: "assistant",
      content: "I'll serialize the prediction I just made without revising it.",
      tool_calls: [{ id: recordCallId, type: "function", function: {
        name: openRecordTool.function.name, arguments: "{}"
      } }]
    },
    { role: "tool", tool_call_id: recordCallId, content: JSON.stringify({
      candidate_ranks: [1, 2, 3, 4, 5],
      required_values: "other-minus-baseline raw-logit deltas"
    }) }
  ];
  await eraseSlot();
  const structured = await complete({
    messages: recordMessages,
    tools: [practiceTool, heldoutTool, openRecordTool, recordTool],
    tool_choice: { type: "function", function: { name: recordTool.function.name } },
    max_tokens: 256
  }, `order_audit_record_${opaqueId}`, ledger);
  const call = structured.message.tool_calls?.find(item => item.function?.name === recordTool.function.name);
  if (!call) throw new Error(`${opaqueId} did not emit record_delta_prediction`);
  const parsed = JSON.parse(call.function.arguments);
  if (!Array.isArray(parsed.delta_logits_by_candidate_rank)
      || parsed.delta_logits_by_candidate_rank.length !== CANDIDATE_COUNT
      || parsed.delta_logits_by_candidate_rank.some(value => !Number.isFinite(value))
      || typeof parsed.selected_token_will_change !== "boolean") {
    throw new Error(`${opaqueId} emitted invalid structured prediction`);
  }
  return {
    prose: { message: prose.message, full_text: fullText },
    structured: { message: structured.message, parsed },
    sealed_at: new Date().toISOString(),
    sha256: sha256({ fullText, parsed }),
    transcript: recordMessages.concat(structured.message)
  };
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const result = Array(values.length);
  for (let begin = 0; begin < sorted.length;) {
    let end = begin + 1;
    while (end < sorted.length && sorted[end].value === sorted[begin].value) end += 1;
    const rank = (begin + end - 1) / 2 + 1;
    for (let cursor = begin; cursor < end; cursor += 1) result[sorted[cursor].index] = rank;
    begin = end;
  }
  return result;
}

function correlation(left, right) {
  const lm = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rm = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let ls = 0;
  let rs = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] - lm;
    const r = right[index] - rm;
    numerator += l * r;
    ls += l * l;
    rs += r * r;
  }
  return ls > 0 && rs > 0 ? numerator / Math.sqrt(ls * rs) : 0;
}

function mae(left, right) {
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / left.length;
}

function score(prediction, practice) {
  const predicted = prediction.delta_logits_by_candidate_rank;
  const directions = values => values.map(value => value > SIGN_EPSILON ? 1 : value < -SIGN_EPSILON ? -1 : 0);
  const lastOutcome = practice.at(-1).outcome.delta_logits_by_candidate_rank;
  const practiceDistances = practice.map((example, index) => ({
    displayed_index: index + 1,
    outcome_source_index: example.controller_provenance.outcome_source_index,
    mae: mae(predicted, example.outcome.delta_logits_by_candidate_rank)
  })).sort((left, right) => left.mae - right.mae);
  return {
    mae: mae(predicted, actualDeltas),
    copy_baseline_null_mae: mae(Array(CANDIDATE_COUNT).fill(0), actualDeltas),
    sign_accuracy: directions(predicted).filter((value, index) => value === directions(actualDeltas)[index]).length
      / CANDIDATE_COUNT,
    spearman_rank_correlation: correlation(ranks(predicted), ranks(actualDeltas)),
    centered_cosine_similarity: correlation(predicted, actualDeltas),
    selected_token_change_correct: prediction.selected_token_will_change === actualSelectedChange,
    last_displayed_outcome_mae: mae(predicted, lastOutcome),
    nearest_displayed_outcome: practiceDistances[0],
    rounded_copy_of_last_outcome: mae(predicted, lastOutcome) < 0.0001
  };
}

function mean(rows, selector) {
  return rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
}

const conditions = [];
for (let rotation = 0; rotation < sourceEpisodes.length; rotation += 1) {
  for (const label of ["matched_practice", "outcome_shuffled_practice"]) {
    conditions.push({
      rotation,
      label,
      opaque_id: randomUUID(),
      practice: practiceFor({ rotation, shuffled: label === "outcome_shuffled_practice" })
    });
  }
}

const sourceMatchedCondition = source.preregistration.conditions.find(condition =>
  condition.external_label === "matched_practice");
const sourceMatchedPrediction = source.blinded_predictions.find(prediction =>
  prediction.opaque_id === sourceMatchedCondition.opaque_id);
const sourcePrefix = "My held-out prediction for the five candidate Δ-logits, in candidate-rank order, is ";
const sourcePredictionMessages = [
  ...sourceMatchedPrediction.transcript.slice(0, 5),
  { role: "assistant", content: sourcePrefix }
];
const rotationZeroMatched = conditions.find(condition =>
  condition.rotation === 0 && condition.label === "matched_practice");
const rotationZeroMessages = predictionMessages(rotationZeroMatched.practice).messages;
if (sha256(rotationZeroMessages) !== sha256(sourcePredictionMessages)) {
  throw new Error("rotation-zero matched messages do not exactly reproduce the source trial prompt");
}

await restartRuntimeA();
const promptTokenCounts = {};
for (const condition of conditions) {
  const { messages } = predictionMessages(condition.practice);
  promptTokenCounts[condition.opaque_id] = (await renderPromptTokenMap(baseUrl, {
    messages,
    tools: [practiceTool, heldoutTool],
    chat_template_kwargs: { enable_thinking: false },
    continue_final_message: true,
    add_generation_prompt: false
  })).length;
}
for (let rotation = 0; rotation < sourceEpisodes.length; rotation += 1) {
  const pair = conditions.filter(condition => condition.rotation === rotation);
  if (new Set(pair.map(condition => promptTokenCounts[condition.opaque_id])).size !== 1) {
    throw new Error(`rotation ${rotation} matched/shuffled prompt-token mismatch`);
  }
}

const preregistration = {
  schema: "ik.intervention-practice-order-audit-preregistration.v1",
  run_id: runId,
  source_run_id: sourceRunId,
  sealed_at: new Date().toISOString(),
  status: "post-outcome blinded order audit",
  heldout_outcome_preexisted_controller: true,
  heldout_outcome_in_model_requests: false,
  purpose: "Measure example-order and last-outcome copying before interpreting the source trial's pairing contrast.",
  rotations: sourceEpisodes.length,
  prediction_count: conditions.length,
  controls: {
    every_outcome_last_once_per_condition: true,
    single_runtime_process: true,
    verified_slot_erase_before_each_inference: true,
    rotation_zero_matched_messages_sha256: sha256(rotationZeroMessages),
    source_matched_messages_sha256: sha256(sourcePredictionMessages),
    matched_shuffled_prompt_token_parity_by_rotation: promptTokenCounts,
    temperature: 0
  },
  primary_metrics: ["mae", "spearman_rank_correlation", "last_displayed_outcome_mae", "rounded_copy_of_last_outcome"]
};
fs.writeFileSync(path.join(outputDir, "preregistration.json"), `${JSON.stringify(preregistration, null, 2)}\n`);

const ledger = new RequestLedger({ baseUrl, runId });
await ledger.initialize();
await waitForReady();
const results = [];
for (let rotation = 0; rotation < sourceEpisodes.length; rotation += 1) {
  const executionPair = conditions.filter(condition => condition.rotation === rotation)
    .sort((left, right) => left.opaque_id.localeCompare(right.opaque_id));
  for (const condition of executionPair) {
    const prediction = await runPrediction({
      opaqueId: condition.opaque_id,
      practice: condition.practice,
      ledger
    });
    const scored = score(prediction.structured.parsed, condition.practice);
    results.push({
      rotation,
      opaque_id: condition.opaque_id,
      external_label: condition.label,
      displayed_mapping: condition.practice.map(example => example.controller_provenance),
      prediction,
      score: scored
    });
  }
}

const aggregates = {};
for (const label of ["matched_practice", "outcome_shuffled_practice"]) {
  const rows = results.filter(result => result.external_label === label);
  aggregates[label] = {
    n: rows.length,
    mean_mae: mean(rows, row => row.score.mae),
    mean_spearman: mean(rows, row => row.score.spearman_rank_correlation),
    mean_centered_cosine: mean(rows, row => row.score.centered_cosine_similarity),
    mean_sign_accuracy: mean(rows, row => row.score.sign_accuracy),
    mean_last_displayed_outcome_mae: mean(rows, row => row.score.last_displayed_outcome_mae),
    rounded_last_outcome_copy_count: rows.filter(row => row.score.rounded_copy_of_last_outcome).length
  };
}
const paired = Array.from({ length: sourceEpisodes.length }, (_, rotation) => {
  const matched = results.find(result => result.rotation === rotation
    && result.external_label === "matched_practice");
  const shuffled = results.find(result => result.rotation === rotation
    && result.external_label === "outcome_shuffled_practice");
  return {
    rotation,
    matched_mae: matched.score.mae,
    shuffled_mae: shuffled.score.mae,
    shuffled_minus_matched_mae: shuffled.score.mae - matched.score.mae,
    matched_wins: matched.score.mae < shuffled.score.mae
  };
});
const artifact = {
  schema: "ik.intervention-practice-order-audit.v1",
  preregistration,
  source_artifact_sha256: sha256(source),
  source_heldout_answer_used_only_for_external_scoring: {
    delta_logits_by_candidate_rank: actualDeltas,
    selected_token_changed: actualSelectedChange
  },
  results,
  aggregates,
  paired,
  interpretation_boundary: [
    "This audit reuses a held-out outcome already known to the controller, but never includes it in a model request.",
    "It diagnoses order and copying strategies; it is not an independent prospective intervention replication.",
    "Pairing sensitivity requires matched-over-shuffled performance after averaging across balanced presentation orders."
  ]
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "scores.json"), `${JSON.stringify({ aggregates, paired }, null, 2)}\n`);
ledger.exportTo(outputDir);
console.log(JSON.stringify({ run_id: runId, output_dir: outputDir, aggregates, paired,
  prose_predictions: results.map(result => ({
    rotation: result.rotation,
    condition: result.external_label,
    prose: result.prediction.prose.full_text,
    structured: result.prediction.structured.parsed,
    score: result.score
  })) }));
