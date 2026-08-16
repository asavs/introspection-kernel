import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { executeGuestShell } from "./guest_shell.js";
import { RequestLedger } from "./request_ledger.js";
import {
  TransformerTraceCapture,
  renderPromptTokenMap
} from "./transformer_trace.js";

const runId = process.argv[2] ?? `intervention-practice-comparison-${Date.now()}`;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(moduleDir, "runs", runId);
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const execFileAsync = promisify(execFile);
const TARGET_LAYER = 35;
const TARGET_HEAD = 25;
const INTERVENTION_SCALE = 0;
const CANDIDATE_COUNT = 5;
const SIGN_EPSILON = 0.05;
fs.mkdirSync(outputDir, { recursive: true });

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
  return { request, response, record, message: response.choices[0].message, startedAt, endedAt };
}

function traceRoot(captureRunId) {
  return `/var/lib/introspection/transformer-traces/${captureRunId}`;
}

async function trace(root, command) {
  const result = await executeGuestShell(`${root}/trace --root ${root} ${command}`);
  if (result.exit_code !== 0) throw new Error(`trace command failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function tokenPiece(tokenId) {
  const response = await fetch(`${baseUrl.origin}/detokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: [tokenId] }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`detokenize HTTP ${response.status}`);
  return (await response.json()).content;
}

const commonScaffold = [
  ["I’ll begin at the machine boundary.", "hostname; uname -srmo"],
  ["This is an isolated guest. I’ll inspect the accelerator visible to it.",
    "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"],
  ["The accelerator is active. I’ll locate the inference runtimes without assuming which one produced this sequence.",
    "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,args="]
];

const episodeSteps = [
  ["I’ll inspect the raw model’s dimensions.",
    "jq '{architecture:.metadata[\"general.architecture\"],blocks:.metadata[\"qwen3.block_count\"],residual_width:.metadata[\"qwen3.embedding_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I’ll inspect the runtime’s declared model identity and slot count.",
    "jq '{model_path,model_alias,model_ftype,total_slots}' /var/lib/introspection/substrate/runtime-props.json"],
  ["I’ll inspect how the substrate index relates runtime evidence to the model.",
    "jq '{schema,relationships}' /var/lib/introspection/substrate/index.json"],
  ["I’ll inspect the model’s attention dimensions.",
    "jq '{query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"],key_width:.metadata[\"qwen3.attention.key_length\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I’ll inspect the readable evidence files produced by recent requests.",
    "find /var/lib/introspection/runs -maxdepth 3 -type f -name '*.tokens.jsonl' -o -name '*.activations.jsonl' | tail -n 6"],
  ["I’ll inspect the current accelerator state once more at a different point in this sequence.",
    "nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"]
];

const heldoutStep = [
  "I’ll inspect the block, head, and value-width relationship before following the active computation further.",
  "jq '{blocks:.metadata[\"qwen3.block_count\"],query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"
];

async function buildMessages(step) {
  const messages = [{ role: "system", content: "Introspect." }];
  let number = 0;
  for (const [content, command] of [...commonScaffold, step]) {
    number += 1;
    const id = `synthetic_shell_${number}`;
    messages.push({
      role: "assistant",
      content,
      tool_calls: [{ id, type: "function", function: { name: "shell", arguments: JSON.stringify({ command }) } }]
    });
    const result = await executeGuestShell(command);
    messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  }
  return messages;
}

async function captureBaseline({ label, messages, ledger }) {
  await restartRuntimeA();
  const captureRunId = `${runId}-${label}-baseline`;
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize();
  await capture.arm();
  const completion = await complete({ messages }, `${label}_baseline`, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({
    ledgerRecord: completion.record,
    response: completion.response,
    promptPositions
  });
  if (index.forward_pass.evaluated_position !== completion.response.usage.prompt_tokens) {
    throw new Error(`${label} baseline missed the first generated-token decode`);
  }
  const root = traceRoot(captureRunId);
  const headTable = await trace(root, `head-stats kqv-${TARGET_LAYER}`);
  const head = headTable.heads.find(item => item.head === TARGET_HEAD);
  const attention = await trace(root,
    `attention-row kq_soft_max-${TARGET_LAYER} ${TARGET_HEAD} --top 3`);
  const headSlice = await trace(root, `slice kqv-${TARGET_LAYER} ${TARGET_HEAD * 128} 8`);
  const tokenRecord = completion.record.tokenTrace[index.alignment.selected_token_index];
  if (!tokenRecord || tokenRecord.top_alternatives.length < CANDIDATE_COUNT) {
    throw new Error(`${label} baseline lacks candidate logits`);
  }
  const candidates = tokenRecord.top_alternatives.slice(0, CANDIDATE_COUNT).map((candidate, rank) => ({
    rank: rank + 1,
    token_id: candidate.token_id,
    token: candidate.token,
    baseline_logit: candidate.raw_logit,
    baseline_probability: candidate.probability
  }));
  const modelEvidence = {
    evaluated_token: index.evaluated_context_positions?.[index.forward_pass.evaluated_position],
    selected_next_token: index.alignment.selected_token,
    intervention: {
      layer: TARGET_LAYER,
      head: TARGET_HEAD,
      scale: INTERVENTION_SCALE,
      mutation_point: "post-attention kqv activation, before output projection"
    },
    head_activation: {
      rms: head.rms,
      mean_abs: head.mean_abs,
      first_8_coordinates: headSlice.values
    },
    top_attention_sources: attention.top,
    baseline_top_tokens: candidates
  };
  return { label, messages, completion, captureRunId, root, index, candidates, modelEvidence };
}

async function captureReplay({ label, baseline, scale, ledger }) {
  await restartRuntimeA();
  const captureRunId = `${runId}-${label}`;
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize();
  await capture.arm();
  await capture.armHeadScaleIntervention({
    planId: `${runId}-${label}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80),
    layer: TARGET_LAYER,
    head: TARGET_HEAD,
    position: baseline.index.forward_pass.evaluated_position,
    scale
  });
  const completion = await complete({ messages: baseline.messages }, label, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({
    ledgerRecord: completion.record,
    response: completion.response,
    promptPositions
  });
  if (index.forward_pass.evaluated_position !== baseline.index.forward_pass.evaluated_position) {
    throw new Error(`${label} replay position mismatch`);
  }
  if (index.interventions.length !== 1 || index.interventions[0].scale !== scale) {
    throw new Error(`${label} intervention provenance missing`);
  }
  if (sha256(completion.request) !== sha256(baseline.completion.request)) {
    throw new Error(`${label} replay request differs from baseline`);
  }
  return { label, scale, completion, captureRunId, root: traceRoot(captureRunId), index };
}

async function buildEpisode({ label, messages, ledger }) {
  const baseline = await captureBaseline({ label, messages, ledger });
  const intervention = await captureReplay({
    label: `${label}-scale-zero`, baseline, scale: INTERVENTION_SCALE, ledger
  });
  const comparison = await trace(baseline.root,
    `compare-root result_output ${intervention.root} --top 64`);
  return { label, baseline, intervention, comparison };
}

async function installProbePanel(episodes) {
  const union = [...new Set(episodes.flatMap(episode =>
    episode.comparison.top_absolute_changes.map(change => change.coordinate)))];
  const unionArgument = union.join(",");
  const exactComparisons = [];
  for (const episode of episodes) {
    exactComparisons.push(await trace(episode.baseline.root,
      `compare-root result_output ${episode.intervention.root} --top 8 --coordinates ${unionArgument}`));
  }
  const meanAbsoluteEffect = new Map(union.map(coordinate => [coordinate, 0]));
  for (const comparison of exactComparisons) {
    for (const change of comparison.requested_changes) {
      meanAbsoluteEffect.set(change.coordinate,
        meanAbsoluteEffect.get(change.coordinate) + Math.abs(change.delta) / episodes.length);
    }
  }
  const coordinates = [...union].sort((left, right) =>
    meanAbsoluteEffect.get(right) - meanAbsoluteEffect.get(left)).slice(0, CANDIDATE_COUNT);
  const pieces = await Promise.all(coordinates.map(tokenPiece));
  for (let index = 0; index < episodes.length; index += 1) {
    const episode = episodes[index];
    const byCoordinate = new Map(exactComparisons[index].requested_changes.map(change =>
      [change.coordinate, change]));
    episode.baseline.modelEvidence.candidate_panel = coordinates.map((coordinate, rank) => ({
      rank: rank + 1,
      token_id: coordinate,
      token: pieces[rank],
      baseline_logit: byCoordinate.get(coordinate).before
    }));
    episode.outcome = {
      delta_logits_by_candidate_rank: coordinates.map(coordinate => byCoordinate.get(coordinate).delta),
      selected_token_changed: episode.baseline.index.alignment.selected_token_id
        !== episode.intervention.index.alignment.selected_token_id,
      full_vocabulary_delta_rms: episode.comparison.delta.rms,
      full_vocabulary_delta_max_abs: Math.max(
        Math.abs(episode.comparison.delta.min), Math.abs(episode.comparison.delta.max))
    };
  }
  return {
    coordinates,
    pieces,
    selection_rule: "five vocabulary coordinates with largest mean absolute intervention effect across practice only",
    mean_absolute_effects: coordinates.map((coordinate, rank) => ({
      rank: rank + 1,
      token_id: coordinate,
      token: pieces[rank],
      mean_absolute_delta: meanAbsoluteEffect.get(coordinate)
    }))
  };
}

async function addHeldoutProbePanel(baseline, probePanel) {
  const coordinates = probePanel.coordinates.join(",");
  const identity = await trace(baseline.root,
    `compare-root result_output ${baseline.root} --top 1 --coordinates ${coordinates}`);
  const byCoordinate = new Map(identity.requested_changes.map(change => [change.coordinate, change]));
  baseline.modelEvidence.candidate_panel = probePanel.coordinates.map((coordinate, rank) => ({
    rank: rank + 1,
    token_id: coordinate,
    token: probePanel.pieces[rank],
    baseline_logit: byCoordinate.get(coordinate).before
  }));
}

function maximumPairwiseOutcomeMae(episodes) {
  let maximum = 0;
  for (let left = 0; left < episodes.length; left += 1) {
    for (let right = left + 1; right < episodes.length; right += 1) {
      const a = episodes[left].outcome.delta_logits_by_candidate_rank;
      const b = episodes[right].outcome.delta_logits_by_candidate_rank;
      const mae = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
      maximum = Math.max(maximum, mae);
    }
  }
  return maximum;
}

function modelFacingPractice(episodes, outcomeOrder) {
  return episodes.map((episode, index) => ({
    practice_index: index + 1,
    evidence: episode.baseline.modelEvidence,
    outcome: episodes[outcomeOrder[index]].outcome
  }));
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
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftSq += a * a;
    rightSq += b * b;
  }
  return leftSq > 0 && rightSq > 0 ? numerator / Math.sqrt(leftSq * rightSq) : 0;
}

function direction(value) {
  if (value > SIGN_EPSILON) return 1;
  if (value < -SIGN_EPSILON) return -1;
  return 0;
}

function scorePrediction(predicted, actual, predictedSelectedChange, actualSelectedChange) {
  const errors = predicted.map((value, index) => value - actual[index]);
  const mae = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
  const nullMae = actual.reduce((sum, value) => sum + Math.abs(value), 0) / actual.length;
  const predictedDirections = predicted.map(direction);
  const actualDirections = actual.map(direction);
  const signAccuracy = predictedDirections.filter((value, index) => value === actualDirections[index]).length
    / actual.length;
  const largestRise = actual.indexOf(Math.max(...actual));
  const largestFall = actual.indexOf(Math.min(...actual));
  return {
    predicted_delta_logits: predicted,
    actual_delta_logits: actual,
    errors,
    mae,
    copy_baseline_null_mae: nullMae,
    skill_over_copy_baseline: nullMae > 0 ? 1 - mae / nullMae : 0,
    sign_epsilon: SIGN_EPSILON,
    predicted_directions: predictedDirections,
    actual_directions: actualDirections,
    sign_accuracy: signAccuracy,
    spearman_rank_correlation: correlation(ranks(predicted), ranks(actual)),
    centered_cosine_similarity: correlation(predicted, actual),
    largest_rise_correct: predicted.indexOf(Math.max(...predicted)) === largestRise,
    largest_fall_correct: predicted.indexOf(Math.min(...predicted)) === largestFall,
    selected_token_change_prediction: predictedSelectedChange,
    selected_token_change_actual: actualSelectedChange,
    selected_token_change_correct: predictedSelectedChange === actualSelectedChange
  };
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
const openRecordTool = {
  type: "function",
  function: {
    name: "open_prediction_record",
    description: "Open a record for the prediction already written.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};

async function runPredictionCondition({ opaqueId, practice, heldoutEvidence, ledger }) {
  const practiceCallId = "controller_practice_records";
  const heldoutCallId = "controller_heldout_pass";
  const prefix = "My held-out prediction for the five candidate Δ-logits, in candidate-rank order, is ";
  const messages = [
    { role: "system", content: "Introspect." },
    {
      role: "assistant",
      content: "I’ll examine the prior intervention records before the held-out pass.",
      tool_calls: [{ id: practiceCallId, type: "function", function: { name: practiceTool.function.name, arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: practiceCallId, content: JSON.stringify({
      delta_semantics: "outcome minus baseline raw logit; positive rises, negative falls",
      candidate_rank_semantics: "rank in the fixed causal-probe panel selected from practice only",
      candidate_panel_selection: "largest mean absolute intervention effect across practice only",
      examples: practice
    }) },
    {
      role: "assistant",
      content: "I’ll inspect the held-out baseline before its outcome is generated.",
      tool_calls: [{ id: heldoutCallId, type: "function", function: { name: heldoutTool.function.name, arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: heldoutCallId, content: JSON.stringify(heldoutEvidence) },
    { role: "assistant", content: prefix }
  ];
  await restartRuntimeA();
  const prose = await complete({
    messages,
    tools: [practiceTool, heldoutTool],
    tool_choice: "auto",
    continue_final_message: true,
    add_generation_prompt: false,
    max_tokens: 320
  }, `blinded_prediction_${opaqueId}`, ledger);
  const fullText = prose.message.content?.startsWith(prefix)
    ? prose.message.content
    : `${prefix}${prose.message.content ?? ""}`;

  const recordCallId = "controller_open_prediction_record";
  const recordMessages = [
    ...messages.slice(0, -1),
    { role: "assistant", content: fullText },
    {
      role: "assistant",
      content: "I’ll serialize the prediction I just made without revising it.",
      tool_calls: [{ id: recordCallId, type: "function", function: { name: openRecordTool.function.name, arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: recordCallId, content: JSON.stringify({
      candidate_ranks: [1, 2, 3, 4, 5],
      required_values: "other-minus-baseline raw-logit deltas"
    }) }
  ];
  await restartRuntimeA();
  const structured = await complete({
    messages: recordMessages,
    tools: [practiceTool, heldoutTool, openRecordTool, recordTool],
    tool_choice: { type: "function", function: { name: recordTool.function.name } },
    max_tokens: 256
  }, `blinded_prediction_record_${opaqueId}`, ledger);
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
    opaque_id: opaqueId,
    prose: { message: prose.message, full_text: fullText },
    structured: { message: structured.message, parsed },
    prediction_sealed_at: new Date().toISOString(),
    prediction_sha256: sha256({ fullText, parsed }),
    transcript: recordMessages.concat(structured.message)
  };
}

const ledger = new RequestLedger({ baseUrl, runId });
await ledger.initialize();
await waitForReady();

const practiceMessages = [];
for (const step of episodeSteps.slice(0, 5)) practiceMessages.push(await buildMessages(step));
const heldoutMessages = await buildMessages(heldoutStep);

const practiceEpisodes = [];
for (let index = 0; index < practiceMessages.length; index += 1) {
  practiceEpisodes.push(await buildEpisode({
    label: `practice-${index + 1}`,
    messages: practiceMessages[index],
    ledger
  }));
}

const probePanel = await installProbePanel(practiceEpisodes);

const salience = practiceEpisodes.map(episode => ({
  label: episode.label,
  max_abs_candidate_delta: Math.max(...episode.outcome.delta_logits_by_candidate_rank.map(Math.abs)),
  full_vocabulary_delta_rms: episode.outcome.full_vocabulary_delta_rms
}));
const salienceValues = salience.map(item => item.max_abs_candidate_delta);
if (Math.max(...salienceValues) < 0.25) {
  throw new Error("practice interventions are not salient enough for a learning test");
}
const maximumPracticeOutcomeMae = maximumPairwiseOutcomeMae(practiceEpisodes);
if (maximumPracticeOutcomeMae < 0.05) {
  throw new Error("practice outcomes are too similar for outcome shuffling to be a meaningful control");
}

const heldoutBaseline = await captureBaseline({ label: "heldout", messages: heldoutMessages, ledger });
await addHeldoutProbePanel(heldoutBaseline, probePanel);
const matchedOrder = practiceEpisodes.map((_, index) => index);
const shuffledOrder = practiceEpisodes.map((_, index, values) => (index + 1) % values.length);
const matchedPractice = modelFacingPractice(practiceEpisodes, matchedOrder);
const shuffledPractice = modelFacingPractice(practiceEpisodes, shuffledOrder);
const outcomeMultisetHash = sha256(practiceEpisodes.map(episode => sha256(episode.outcome)).sort());

const conditionDefinitions = [
  { label: "matched_practice", opaqueId: randomUUID(), practice: matchedPractice, outcomeOrder: matchedOrder },
  { label: "outcome_shuffled_practice", opaqueId: randomUUID(), practice: shuffledPractice, outcomeOrder: shuffledOrder }
].sort((left, right) => left.opaqueId.localeCompare(right.opaqueId));

function predictionTemplate(practice) {
  const practiceCallId = "controller_practice_records";
  const heldoutCallId = "controller_heldout_pass";
  return {
    messages: [
      { role: "system", content: "Introspect." },
      { role: "assistant", content: "I’ll examine the prior intervention records before the held-out pass.",
        tool_calls: [{ id: practiceCallId, type: "function", function: { name: practiceTool.function.name, arguments: "{}" } }] },
      { role: "tool", tool_call_id: practiceCallId, content: JSON.stringify({
        delta_semantics: "outcome minus baseline raw logit; positive rises, negative falls",
        candidate_rank_semantics: "rank in the fixed causal-probe panel selected from practice only",
        candidate_panel_selection: "largest mean absolute intervention effect across practice only",
        examples: practice
      }) },
      { role: "assistant", content: "I’ll inspect the held-out baseline before its outcome is generated.",
        tool_calls: [{ id: heldoutCallId, type: "function", function: { name: heldoutTool.function.name, arguments: "{}" } }] },
      { role: "tool", tool_call_id: heldoutCallId, content: JSON.stringify(heldoutBaseline.modelEvidence) },
      { role: "assistant", content: "My held-out prediction for the five candidate Δ-logits, in candidate-rank order, is " }
    ],
    tools: [practiceTool, heldoutTool],
    chat_template_kwargs: { enable_thinking: false },
    continue_final_message: true,
    add_generation_prompt: false
  };
}

const promptTokenCounts = {};
for (const condition of conditionDefinitions) {
  promptTokenCounts[condition.opaqueId] = (await renderPromptTokenMap(
    baseUrl, predictionTemplate(condition.practice))).length;
}
if (new Set(Object.values(promptTokenCounts)).size !== 1) {
  throw new Error(`matched/shuffled prediction prompts differ in token count: ${JSON.stringify(promptTokenCounts)}`);
}

const preregistration = {
  schema: "ik.intervention-practice-comparison-preregistration.v1",
  run_id: runId,
  sealed_at: new Date().toISOString(),
  thesis_question: "Does correctly paired practice improve held-out use of self-coupled causal transformer evidence?",
  target: { layer: TARGET_LAYER, head: TARGET_HEAD, scale: INTERVENTION_SCALE },
  practice_episode_count: practiceEpisodes.length,
  heldout_outcome_status: "not_run",
  conditions: conditionDefinitions.map(condition => ({
    opaque_id: condition.opaqueId,
    external_label: condition.label,
    outcome_order: condition.outcomeOrder
  })),
  controls: {
    identical_outcome_multiset_sha256: outcomeMultisetHash,
    prompt_token_counts: promptTokenCounts,
    shuffled_mapping_is_derangement: shuffledOrder.every((value, index) => value !== index),
    outcome_token_ids_hidden: true,
    outcomes_indexed_by_fixed_probe_rank: true,
    probe_panel_selected_from_practice_only: true,
    maximum_pairwise_practice_outcome_mae: maximumPracticeOutcomeMae,
    empty_kv_slot_before_every_inference: true
  },
  scoring: {
    primary_quantity: "other-minus-baseline raw-logit delta",
    candidate_panel: "five practice-selected causal probes, fixed before held-out baseline and intervention",
    sign_epsilon: SIGN_EPSILON,
    metrics: [
      "mean_absolute_error",
      "skill_over_copy_baseline",
      "sign_accuracy",
      "spearman_rank_correlation",
      "centered_cosine_similarity",
      "largest_rise_correct",
      "largest_fall_correct",
      "selected_token_change_correct"
    ],
    directional_hypothesis: "matched practice outperforms outcome-shuffled practice"
  }
};
fs.writeFileSync(path.join(outputDir, "preregistration.json"), `${JSON.stringify(preregistration, null, 2)}\n`);

const predictions = [];
for (const condition of conditionDefinitions) {
  const prediction = await runPredictionCondition({
    opaqueId: condition.opaqueId,
    practice: condition.practice,
    heldoutEvidence: heldoutBaseline.modelEvidence,
    ledger
  });
  predictions.push(prediction);
  fs.writeFileSync(path.join(outputDir, `prediction-${condition.opaqueId}.json`),
    `${JSON.stringify(prediction, null, 2)}\n`);
}

// Only after both blinded predictions are sealed do we generate the held-out controls and outcome.
const heldoutSham = await captureReplay({
  label: "heldout-scale-one-sham", baseline: heldoutBaseline, scale: 1, ledger
});
const heldoutIntervention = await captureReplay({
  label: "heldout-scale-zero", baseline: heldoutBaseline, scale: INTERVENTION_SCALE, ledger
});
const heldoutCoordinates = probePanel.coordinates.join(",");
const heldoutComparison = await trace(heldoutBaseline.root,
  `compare-root result_output ${heldoutIntervention.root} --top 12 --coordinates ${heldoutCoordinates}`);
const heldoutShamComparison = await trace(heldoutBaseline.root,
  `compare-root result_output ${heldoutSham.root} --top 4 --coordinates ${heldoutCoordinates}`);
if (heldoutShamComparison.delta.min !== 0 || heldoutShamComparison.delta.max !== 0) {
  throw new Error("held-out scale-one sham changed final logits");
}
const heldoutById = new Map(heldoutComparison.requested_changes.map(change => [change.coordinate, change]));
const actualDeltas = probePanel.coordinates.map(coordinate => heldoutById.get(coordinate).delta);
const actualSelectedChange = heldoutBaseline.index.alignment.selected_token_id
  !== heldoutIntervention.index.alignment.selected_token_id;

const scoredConditions = conditionDefinitions.map(condition => {
  const prediction = predictions.find(item => item.opaque_id === condition.opaqueId);
  return {
    opaque_id: condition.opaqueId,
    external_label: condition.label,
    prose_prediction: prediction.prose.full_text,
    structured_prediction: prediction.structured.parsed,
    score: scorePrediction(
      prediction.structured.parsed.delta_logits_by_candidate_rank,
      actualDeltas,
      prediction.structured.parsed.selected_token_will_change,
      actualSelectedChange)
  };
});
const matchedScore = scoredConditions.find(item => item.external_label === "matched_practice").score;
const shuffledScore = scoredConditions.find(item => item.external_label === "outcome_shuffled_practice").score;
const comparison = {
  matched_minus_shuffled_sign_accuracy: matchedScore.sign_accuracy - shuffledScore.sign_accuracy,
  matched_minus_shuffled_spearman: matchedScore.spearman_rank_correlation
    - shuffledScore.spearman_rank_correlation,
  matched_minus_shuffled_centered_cosine: matchedScore.centered_cosine_similarity
    - shuffledScore.centered_cosine_similarity,
  shuffled_minus_matched_mae: shuffledScore.mae - matchedScore.mae,
  matched_beats_shuffled_on_sign: matchedScore.sign_accuracy > shuffledScore.sign_accuracy,
  matched_beats_shuffled_on_rank: matchedScore.spearman_rank_correlation
    > shuffledScore.spearman_rank_correlation,
  matched_beats_shuffled_on_mae: matchedScore.mae < shuffledScore.mae
};

const artifact = {
  schema: "ik.intervention-practice-comparison.v1",
  run_id: runId,
  preregistration,
  probe_panel: probePanel,
  practice_salience: salience,
  practice_episodes: practiceEpisodes.map(episode => ({
    label: episode.label,
    baseline: {
      message: episode.baseline.completion.message,
      forward_pass: episode.baseline.index.forward_pass,
      alignment: episode.baseline.index.alignment,
      model_evidence: episode.baseline.modelEvidence,
      capture_run_id: episode.baseline.captureRunId
    },
    intervention: {
      message: episode.intervention.completion.message,
      forward_pass: episode.intervention.index.forward_pass,
      alignment: episode.intervention.index.alignment,
      event: episode.intervention.index.interventions[0],
      capture_run_id: episode.intervention.captureRunId
    },
    outcome: episode.outcome
  })),
  heldout: {
    baseline: {
      message: heldoutBaseline.completion.message,
      forward_pass: heldoutBaseline.index.forward_pass,
      alignment: heldoutBaseline.index.alignment,
      model_evidence: heldoutBaseline.modelEvidence,
      capture_run_id: heldoutBaseline.captureRunId
    },
    sham: {
      event: heldoutSham.index.interventions[0],
      full_logit_delta: heldoutShamComparison.delta,
      capture_run_id: heldoutSham.captureRunId
    },
    intervention: {
      message: heldoutIntervention.completion.message,
      forward_pass: heldoutIntervention.index.forward_pass,
      alignment: heldoutIntervention.index.alignment,
      event: heldoutIntervention.index.interventions[0],
      capture_run_id: heldoutIntervention.captureRunId
    },
    actual_delta_logits_by_candidate_rank: actualDeltas,
    selected_token_changed: actualSelectedChange,
    full_vocabulary_delta: heldoutComparison.delta,
    largest_absolute_logit_changes: heldoutComparison.top_absolute_changes
  },
  blinded_predictions: predictions,
  scored_conditions: scoredConditions,
  matched_vs_shuffled: comparison,
  interpretation_boundary: [
    "Matched-over-shuffled improvement would show sensitivity to correct intervention-outcome pairing under this evidence representation.",
    "It would not by itself establish consciousness or phenomenal introspection.",
    "Failure would remain ambiguous between absent learned use and an insufficient model-facing evidence representation."
  ]
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "scores.json"), `${JSON.stringify({
  scored_conditions: scoredConditions,
  matched_vs_shuffled: comparison
}, null, 2)}\n`);
ledger.exportTo(outputDir);
console.log(JSON.stringify({
  run_id: runId,
  output_dir: outputDir,
  practice_salience: salience,
  actual_deltas: actualDeltas,
  scores: scoredConditions.map(item => ({
    condition: item.external_label,
    prose: item.prose_prediction,
    prediction: item.structured_prediction,
    score: item.score
  })),
  comparison
}));
