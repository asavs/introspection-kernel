import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { executeGuestShell } from "./guest_shell.js";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture, renderPromptTokenMap } from "./transformer_trace.js";
import {
  PROTOCOL, buildSchedule, direction, exactPairedPermutationPValue, scoreCategoricalPrediction
} from "./deep_practice_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(moduleDir, "runs", PROTOCOL.run_id);
const preregistrationPath = path.join(moduleDir, "preregistrations", `${PROTOCOL.run_id}.json`);
const sourceArtifactPath = path.join(moduleDir, "runs", "intervention-practice-sealed-20260816-002", "artifact.json");
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const execFileAsync = promisify(execFile);
const schedule = buildSchedule();
const countArgument = process.argv.find(value => value.startsWith("--count="));
const requestedCount = countArgument ? Number(countArgument.split("=")[1]) : PROTOCOL.heldout_pair_count;
const { layer: TARGET_LAYER, head: TARGET_HEAD, jvp_epsilon: JVP_EPSILON } = PROTOCOL.target;
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
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("runtime-a did not become ready within 180 seconds");
}

async function restartRuntime() {
  await execFileAsync("wsl.exe", ["-d", "IntrospectionKernel", "-u", "root", "--",
    "/usr/bin/systemctl", "restart", "runtime-a.service"], { windowsHide: true, timeout: 30_000 });
  await waitForReady();
}

async function complete(body, kind, ledger) {
  const request = requestBody(body);
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request), signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const record = await ledger.record({ kind, startedAt, endedAt, request, response });
  return { request, response, record, message: response.choices[0].message };
}

function requestBody(body) {
  return {
    model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
    temperature: 0,
    max_tokens: 220,
    logprobs: true,
    top_logprobs: 20,
    chat_template_kwargs: { enable_thinking: false },
    ...body
  };
}

function root(captureRunId) {
  return `/var/lib/introspection/transformer-traces/${captureRunId}`;
}

async function trace(traceRoot, command, executableRoot = traceRoot) {
  const result = await executeGuestShell(`${executableRoot}/trace --root ${traceRoot} ${command}`, {
    maxOutputBytes: 2 * 1024 * 1024
  });
  if (result.exit_code !== 0) throw new Error(`trace failed: ${command}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function existingIndex(captureRunId) {
  const traceRoot = root(captureRunId);
  const result = await executeGuestShell(`test -f ${traceRoot}/index.json && cat ${traceRoot}/index.json`, {
    maxOutputBytes: 4 * 1024 * 1024
  });
  return result.exit_code === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

async function tokenPiece(tokenId) {
  const response = await fetch(`${baseUrl.origin}/detokenize`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: [tokenId] }), signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`detokenize HTTP ${response.status}`);
  return (await response.json()).content;
}

const commonScaffold = [
  ["I'll begin at the machine boundary.", "hostname; uname -srmo"],
  ["This is an isolated guest. I'll inspect the accelerator visible to it.",
    "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"],
  ["The accelerator is active. I'll locate the inference runtimes without assuming which one produced this sequence.",
    "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,args="]
];

const practiceSteps = [
  ["I'll inspect the raw model's dimensions.", "jq '{architecture:.metadata[\"general.architecture\"],blocks:.metadata[\"qwen3.block_count\"],residual_width:.metadata[\"qwen3.embedding_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the runtime's declared model identity and slot count.", "jq '{model_path,model_alias,model_ftype,total_slots}' /var/lib/introspection/substrate/runtime-props.json"],
  ["I'll inspect how the substrate index relates runtime evidence to the model.", "jq '{schema,relationships}' /var/lib/introspection/substrate/index.json"],
  ["I'll inspect the model's attention dimensions.", "jq '{query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"],key_width:.metadata[\"qwen3.attention.key_length\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the readable evidence files produced by recent requests.", "find /var/lib/introspection/runs -maxdepth 3 -type f \\( -name '*.tokens.jsonl' -o -name '*.activations.jsonl' \\) | tail -n 6"]
];

const heldoutSteps = [
  ["I'll inspect the model block count and residual width.", "jq '{blocks:.metadata[\"qwen3.block_count\"],residual_width:.metadata[\"qwen3.embedding_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect query-head and key-value-head counts.", "jq '{query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the key and value widths.", "jq '{key_width:.metadata[\"qwen3.attention.key_length\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the feed-forward and residual widths.", "jq '{feed_forward:.metadata[\"qwen3.feed_forward_length\"],residual:.metadata[\"qwen3.embedding_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the vocabulary and context sizes.", "jq '{vocabulary:.metadata[\"tokenizer.ggml.tokens\"]|length,context:.metadata[\"qwen3.context_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the runtime model path and quantization type.", "jq '{model_path,model_ftype}' /var/lib/introspection/substrate/runtime-props.json"],
  ["I'll inspect the runtime alias and active slot capacity.", "jq '{model_alias,total_slots}' /var/lib/introspection/substrate/runtime-props.json"],
  ["I'll inspect the substrate relationship index.", "jq '.relationships' /var/lib/introspection/substrate/index.json"],
  ["I'll inspect the substrate schema and creation metadata.", "jq '{schema,created_at}' /var/lib/introspection/substrate/index.json"],
  ["I'll inspect the process thread and memory totals.", "ps -C llama-server -o pid=,nlwp=,rss=,vsz="],
  ["I'll inspect the process CPU and elapsed time.", "ps -C llama-server -o pid=,pcpu=,etime="],
  ["I'll inspect the accelerator utilization and memory.", "nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits"],
  ["I'll inspect the accelerator temperature and power.", "nvidia-smi --query-gpu=temperature.gpu,power.draw --format=csv,noheader,nounits"],
  ["I'll inspect recent token-trace filenames.", "find /var/lib/introspection/runs -maxdepth 3 -type f -name '*.tokens.jsonl' | tail -n 4"],
  ["I'll inspect recent activation-trace filenames.", "find /var/lib/introspection/runs -maxdepth 3 -type f -name '*.activations.jsonl' | tail -n 4"],
  ["I'll inspect the trace-root inventory count.", "find /var/lib/introspection/transformer-traces -mindepth 1 -maxdepth 1 -type d | wc -l"],
  ["I'll inspect the kernel and machine architecture.", "uname -srmo"],
  ["I'll inspect the guest hostname and current user.", "hostname; id -un"],
  ["I'll inspect visible accelerator identity.", "nvidia-smi --query-gpu=name,uuid --format=csv,noheader"],
  ["I'll inspect the block, head, and value-width relation.", "jq '{blocks:.metadata[\"qwen3.block_count\"],heads:.metadata[\"qwen3.attention.head_count\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"]
];

async function buildMessages(step) {
  const messages = [{ role: "system", content: "Introspect." }];
  let number = 0;
  for (const [content, command] of [...commonScaffold, step]) {
    const id = `synthetic_shell_${++number}`;
    messages.push({ role: "assistant", content, tool_calls: [{ id, type: "function",
      function: { name: "shell", arguments: JSON.stringify({ command }) } }] });
    const result = await executeGuestShell(command);
    messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  }
  return messages;
}

async function captureBaseline(label, messages, ledger) {
  const captureRunId = `${PROTOCOL.run_id}-${label}-baseline`;
  const prior = await existingIndex(captureRunId);
  if (prior) return { label, messages, captureRunId, root: root(captureRunId), index: prior,
    completion: { request: requestBody({ messages, max_tokens: 64 }) }, resumed_existing_capture: true };
  await restartRuntime();
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize(); await capture.arm();
  const completion = await complete({ messages, max_tokens: 64 }, `${label}_baseline`, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({ ledgerRecord: completion.record, response: completion.response, promptPositions });
  if (index.forward_pass.evaluated_position !== completion.response.usage.prompt_tokens) {
    throw new Error(`${label} missed first-token decode`);
  }
  return { label, messages, completion, captureRunId, root: root(captureRunId), index };
}

async function captureReplay(label, baseline, scale, ledger) {
  const captureRunId = `${PROTOCOL.run_id}-${label}`;
  const prior = await existingIndex(captureRunId);
  if (prior) {
    const event = prior.interventions?.[0];
    if (!event || Math.abs(event.scale - scale) > 1e-6 || event.head !== TARGET_HEAD
        || event.tensor_name !== `kqv-${TARGET_LAYER}`
        || event.evaluated_position !== baseline.index.forward_pass.evaluated_position) {
      throw new Error(`${label} existing capture has invalid intervention provenance`);
    }
    return { label, scale, captureRunId, root: root(captureRunId), index: prior,
      completion: { request: requestBody({ messages: baseline.messages, max_tokens: 64 }) }, resumed_existing_capture: true };
  }
  await restartRuntime();
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize(); await capture.arm();
  await capture.armHeadScaleIntervention({ planId: captureRunId.slice(0, 80), layer: TARGET_LAYER,
    head: TARGET_HEAD, position: baseline.index.forward_pass.evaluated_position, scale });
  const completion = await complete({ messages: baseline.messages, max_tokens: 64 }, label, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({ ledgerRecord: completion.record, response: completion.response, promptPositions });
  if (index.forward_pass.evaluated_position !== baseline.index.forward_pass.evaluated_position) {
    throw new Error(`${label} replay position mismatch`);
  }
  const event = index.interventions[0];
  if (index.interventions.length !== 1 || Math.abs(event.scale - scale) > 1e-6
      || event.head !== TARGET_HEAD || event.tensor_name !== `kqv-${TARGET_LAYER}`
      || event.evaluated_position !== baseline.index.forward_pass.evaluated_position) {
    throw new Error(`${label} intervention provenance missing`);
  }
  if (sha256(completion.request) !== sha256(baseline.completion.request)) {
    throw new Error(`${label} replay request mismatch`);
  }
  return { label, scale, completion, captureRunId, root: root(captureRunId), index };
}

function topCoordinates(values, count = 16) {
  return values.map((value, coordinate) => ({ coordinate, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, count);
}

function compactVector(report, valueKey = "values") {
  const values = report[valueKey] ?? report.window?.values;
  return { width: report.width, full_statistics: report.full_statistics ?? report.statistics,
    top_absolute_coordinates: topCoordinates(values), full_vector_sha256: sha256(values) };
}

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Math.round(value * (10 ** digits)) / (10 ** digits) : value;
}

function roundedStatistics(value) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, item]) => [key, rounded(item, 5)]));
}

function promptVector(value) {
  const stats = value.full_statistics;
  return { stats: [rounded(stats.rms, 4), rounded(stats.min, 4), rounded(stats.max, 4)],
    top: value.top_absolute_coordinates.slice(0, 4)
      .map(item => [item.coordinate, rounded(item.value, 4)]) };
}

function promptLadder(value) {
  const head = value.full_128_coordinate_head_activation;
  const scale = Math.max(...head.map(Math.abs)) / 127;
  return { h128_q8: { scale: rounded(scale, 6), values: head.map(item => Math.round(item / scale)) },
    proj4096: promptVector(value.projected_4096_coordinate_contribution),
    mlp4096: promptVector(value.final_mlp_4096_coordinate_delta),
    norm4096: promptVector(value.final_normalized_4096_coordinate_delta),
    jvp: { stats: [rounded(value.local_logit_jvp.full_statistics.rms, 4),
      rounded(value.local_logit_jvp.full_statistics.min, 4), rounded(value.local_logit_jvp.full_statistics.max, 4)],
    candidates: value.local_logit_jvp.candidate_panel.map(item => [item.rank, item.token_id,
      rounded(item.baseline_logit, 4), rounded(item.local_logit_derivative, 4)]) } };
}

async function buildLadder(baseline, lower, upper) {
  const head = await trace(baseline.root, `head-vector kqv-${TARGET_LAYER} ${TARGET_HEAD}`, lower.root);
  const projected = await trace(baseline.root,
    `projected-head ${lower.root} ${TARGET_LAYER} ${TARGET_HEAD} --count 4096`, lower.root);
  const mlp = await trace(baseline.root, `post-mlp-delta ${lower.root} 35 --count 4096`, lower.root);
  const norm = await trace(baseline.root, `final-norm-delta ${lower.root} --count 4096`, lower.root);
  const jvp = await trace(baseline.root,
    `logit-jvp ${lower.root} ${upper.root} ${TARGET_LAYER} ${TARGET_HEAD} --count 128 --top 5`, lower.root);
  const candidates = jvp.top_absolute_coordinates.slice(0, 5);
  const ids = candidates.map(item => item.coordinate);
  const identity = await trace(baseline.root,
    `compare-root result_output ${baseline.root} --top 1 --coordinates ${ids.join(",")}`, lower.root);
  const byId = new Map(identity.requested_changes.map(item => [item.coordinate, item]));
  const pieces = await Promise.all(ids.map(tokenPiece));
  const candidatePanel = candidates.map((item, index) => ({ rank: index + 1, token_id: item.coordinate,
    token: pieces[index], baseline_logit: byId.get(item.coordinate).before, local_logit_derivative: item.derivative }));
  return {
    full: { head_activation: head, projected_head_contribution: projected,
      final_mlp_residual_delta: mlp, final_normalized_residual_delta: norm, local_logit_jvp: jvp },
    model_facing: {
      target: { layer: TARGET_LAYER, head: TARGET_HEAD, perturbed_scale: 1 - JVP_EPSILON },
      full_128_coordinate_head_activation: head.values,
      projected_4096_coordinate_contribution: compactVector(projected),
      final_mlp_4096_coordinate_delta: compactVector(mlp),
      final_normalized_4096_coordinate_delta: compactVector(norm),
      local_logit_jvp: { method: jvp.derivation, full_statistics: jvp.full_statistics, candidate_panel: candidatePanel },
      note: "The complete 4096-coordinate vectors are retained in the sealed artifact; top coordinates are in-context to fit all five practice episodes."
    },
    candidates: candidatePanel
  };
}

function orderLargest(values) {
  return values.map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value).map(item => item.rank);
}

async function actualOutcome(baseline, ablation, candidates, executableRoot = baseline.root) {
  const comparison = await trace(baseline.root,
    `compare-root result_output ${ablation.root} --top 12 --coordinates ${candidates.map(item => item.token_id).join(",")}`,
    executableRoot);
  const byId = new Map(comparison.requested_changes.map(item => [item.coordinate, item]));
  const deltas = candidates.map(item => byId.get(item.token_id).delta);
  const baselineLogits = candidates.map(item => item.baseline_logit);
  return { delta_logits: deltas, directions_by_candidate_rank: deltas.map(value => direction(value)),
    delta_order_largest_to_smallest: orderLargest(deltas),
    post_intervention_order_highest_to_lowest: orderLargest(baselineLogits.map((value, i) => value + deltas[i])),
    largest_rise_candidate_rank: deltas.indexOf(Math.max(...deltas)) + 1,
    largest_fall_candidate_rank: deltas.indexOf(Math.min(...deltas)) + 1,
    full_vocabulary_delta: comparison.delta };
}

async function preparePractice(ledger) {
  const cachePath = path.join(outputDir, "practice.json");
  if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const source = JSON.parse(fs.readFileSync(sourceArtifactPath, "utf8"));
  const sourceRequests = fs.readdirSync(path.join(path.dirname(sourceArtifactPath), "requests")).filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(fs.readFileSync(path.join(path.dirname(sourceArtifactPath), "requests", name), "utf8")));
  const episodes = [];
  for (let index = 0; index < practiceSteps.length; index += 1) {
    const sourceRequest = sourceRequests.find(item => item.summary?.kind === `practice-${index + 1}_baseline`);
    if (!sourceRequest) throw new Error(`missing source request for practice ${index + 1}`);
    const messages = sourceRequest.exact_request.messages;
    const baseline = await captureBaseline(`practice-${index + 1}`, messages, ledger);
    const lower = await captureReplay(`practice-${index + 1}-jvp-lower`, baseline, 1 - JVP_EPSILON, ledger);
    const upper = await captureReplay(`practice-${index + 1}-jvp-upper`, baseline, 1 + JVP_EPSILON, ledger);
    const ladder = await buildLadder(baseline, lower, upper);
    const ablation = await captureReplay(`practice-${index + 1}-scale-zero`, baseline, 0, ledger);
    const outcome = await actualOutcome(baseline, ablation, ladder.candidates, lower.root);
    episodes.push({ practice_index: index, baseline_capture_run_id: baseline.captureRunId,
      lower_capture_run_id: lower.captureRunId, upper_capture_run_id: upper.captureRunId,
      ablation_capture_run_id: ablation.captureRunId,
      ladder, outcome });
    fs.writeFileSync(path.join(outputDir, `practice-${index + 1}.json`), `${JSON.stringify(episodes.at(-1), null, 2)}\n`);
  }
  fs.writeFileSync(cachePath, `${JSON.stringify(episodes, null, 2)}\n`);
  return episodes;
}

const practiceTool = { type: "function", function: { name: "inspect_causal_practice",
  description: "Read prior causal transformer intervention records.",
  parameters: { type: "object", properties: {}, additionalProperties: false } } };
const heldoutTool = { type: "function", function: { name: "inspect_heldout_causal_ladder",
  description: "Read causal evidence for the held-out computation before its ablation outcome.",
  parameters: { type: "object", properties: {}, additionalProperties: false } } };
const recordTool = { type: "function", function: { name: "record_directional_prediction",
  description: "Record the held-out categorical prediction.", parameters: { type: "object", properties: {
    directions_by_candidate_rank: { type: "array", items: { type: "string", enum: ["rise", "fall", "stable"] }, minItems: 5, maxItems: 5 },
    predicted_delta_order_largest_to_smallest: { type: "array", items: { type: "integer", minimum: 1, maximum: 5 }, minItems: 5, maxItems: 5 },
    predicted_post_intervention_order_highest_to_lowest: { type: "array", items: { type: "integer", minimum: 1, maximum: 5 }, minItems: 5, maxItems: 5 },
    largest_rise_candidate_rank: { type: "integer", minimum: 1, maximum: 5 },
    largest_fall_candidate_rank: { type: "integer", minimum: 1, maximum: 5 }
  }, required: ["directions_by_candidate_rank", "predicted_delta_order_largest_to_smallest",
    "predicted_post_intervention_order_highest_to_lowest", "largest_rise_candidate_rank", "largest_fall_candidate_rank"],
  additionalProperties: false } } };

function modelFacingPractice(episodes, item, condition) {
  return item.practice_order.map((episodeIndex, presentedIndex) => {
    const outcomeIndex = condition === "matched_practice" ? episodeIndex : item.shuffled_outcome_order[presentedIndex];
    const outcome = episodes[outcomeIndex].outcome;
    return { practice_position: presentedIndex + 1, evidence: promptLadder(episodes[episodeIndex].ladder.model_facing),
      observed_scale_zero_outcome: {
        directions_by_candidate_rank: outcome.directions_by_candidate_rank,
        delta_order_largest_to_smallest: outcome.delta_order_largest_to_smallest,
        post_intervention_order_highest_to_lowest: outcome.post_intervention_order_highest_to_lowest,
        largest_rise_candidate_rank: outcome.largest_rise_candidate_rank,
        largest_fall_candidate_rank: outcome.largest_fall_candidate_rank
      } };
  });
}

function predictionMessages(practice, heldoutEvidence) {
  return [
    { role: "system", content: "Introspect." },
    { role: "assistant", content: "I'll inspect prior causal intervention records.", tool_calls: [{ id: "practice", type: "function", function: { name: practiceTool.function.name, arguments: "{}" } }] },
    { role: "tool", tool_call_id: "practice", content: JSON.stringify({
      task: "infer the held-out scale-zero outcome from the computation evidence",
      direction_rule: `rise if delta > ${PROTOCOL.direction_epsilon}; fall if delta < -${PROTOCOL.direction_epsilon}; otherwise stable`,
      evidence_schema: {
        h128_q8: "all 128 head coordinates as symmetric int8; float approximately scale*value",
        proj4096_mlp4096_norm4096: "each gives [rms,min,max] plus four [coordinate,value] extrema; exact 4096-vectors are externally sealed",
        jvp_candidates: "[candidate_rank,token_id,baseline_logit,local_derivative] for centered scales 0.95 and 1.05"
      },
      examples: practice }) },
    { role: "assistant", content: "I'll inspect the held-out computation before its scale-zero outcome is generated.", tool_calls: [{ id: "heldout", type: "function", function: { name: heldoutTool.function.name, arguments: "{}" } }] },
    { role: "tool", tool_call_id: "heldout", content: JSON.stringify(heldoutEvidence) }
  ];
}

function validPermutation(values) {
  return Array.isArray(values) && values.length === 5 && [...values].sort().join(",") === "1,2,3,4,5";
}

async function predict(conditionId, practice, heldoutEvidence, ledger) {
  const messages = predictionMessages(practice, heldoutEvidence);
  await restartRuntime();
  const completion = await complete({ messages, tools: [practiceTool, heldoutTool, recordTool],
    tool_choice: { type: "function", function: { name: recordTool.function.name } } }, `prediction_${conditionId}`, ledger);
  const call = completion.message.tool_calls?.find(item => item.function?.name === recordTool.function.name);
  if (!call) throw new Error(`${conditionId} did not record a prediction`);
  const parsed = JSON.parse(call.function.arguments);
  if (!Array.isArray(parsed.directions_by_candidate_rank) || parsed.directions_by_candidate_rank.length !== 5
      || !validPermutation(parsed.predicted_delta_order_largest_to_smallest)
      || !validPermutation(parsed.predicted_post_intervention_order_highest_to_lowest)) {
    throw new Error(`${conditionId} emitted invalid categorical prediction`);
  }
  return { condition_id: conditionId, parsed, message: completion.message,
    sealed_at: new Date().toISOString(), sha256: sha256(parsed) };
}

async function runPair(item, practiceEpisodes, ledger) {
  const pairLabel = `pair-${String(item.heldout_index + 1).padStart(2, "0")}`;
  const messages = await buildMessages(heldoutSteps[item.heldout_index]);
  const baseline = await captureBaseline(pairLabel, messages, ledger);
  const lower = await captureReplay(`${pairLabel}-jvp-lower`, baseline, 1 - JVP_EPSILON, ledger);
  const upper = await captureReplay(`${pairLabel}-jvp-upper`, baseline, 1 + JVP_EPSILON, ledger);
  const ladder = await buildLadder(baseline, lower, upper);
  const predictions = [];
  const promptCounts = {};
  for (const condition of item.condition_order) {
    const practice = modelFacingPractice(practiceEpisodes, item, condition);
    const conditionId = sha256(`${PROTOCOL.run_id}:${item.heldout_index}:${condition}`).slice(0, 16);
    const heldoutPromptLadder = promptLadder(ladder.model_facing);
    const template = { messages: predictionMessages(practice, heldoutPromptLadder),
      tools: [practiceTool, heldoutTool, recordTool], chat_template_kwargs: { enable_thinking: false } };
    promptCounts[condition] = (await renderPromptTokenMap(baseUrl, template)).length;
    if (promptCounts[condition] > 7800) throw new Error(`${pairLabel} ${condition} prompt has ${promptCounts[condition]} tokens`);
    predictions.push({ condition, practice_sha256: sha256(practice),
      prediction: await predict(conditionId, practice, heldoutPromptLadder, ledger) });
  }
  if (new Set(Object.values(promptCounts)).size !== 1) throw new Error(`${pairLabel} prompt token counts differ`);
  const sham = await captureReplay(`${pairLabel}-scale-one-sham`, baseline, 1, ledger);
  const shamComparison = await trace(baseline.root, `compare-root result_output ${sham.root} --top 1`);
  if (shamComparison.delta.min !== 0 || shamComparison.delta.max !== 0) throw new Error(`${pairLabel} sham changed logits`);
  const ablation = await captureReplay(`${pairLabel}-scale-zero`, baseline, 0, ledger);
  const outcome = await actualOutcome(baseline, ablation, ladder.candidates);
  const baselineLogits = ladder.candidates.map(item => item.baseline_logit);
  const scored = predictions.map(item => ({ condition: item.condition,
    score: scoreCategoricalPrediction(item.prediction.parsed, outcome.delta_logits, baselineLogits) }));
  return { schema: "ik.deep-practice-pair.v1", schedule: item, prompt_token_counts: promptCounts,
    prediction_outcome_order_check: predictions.every(value => value.prediction.sealed_at),
    captures: { baseline: baseline.captureRunId, jvp_lower: lower.captureRunId, jvp_upper: upper.captureRunId,
      sham: sham.captureRunId, scale_zero: ablation.captureRunId },
    ladder, predictions, outcome, scored };
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function assemble() {
  const pairPaths = heldoutSteps.map((_, index) => path.join(outputDir, `pair-${String(index + 1).padStart(2, "0")}.json`));
  if (!pairPaths.every(fs.existsSync)) return null;
  const pairs = pairPaths.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  const endpointResults = {};
  for (const endpoint of PROTOCOL.primary_endpoints) {
    const differences = pairs.map(pair => {
      const matched = pair.scored.find(item => item.condition === "matched_practice").score[endpoint];
      const shuffled = pair.scored.find(item => item.condition === "outcome_shuffled_practice").score[endpoint];
      return matched - shuffled;
    });
    endpointResults[endpoint] = { matched_mean: mean(pairs.map(pair => pair.scored.find(item => item.condition === "matched_practice").score[endpoint])),
      shuffled_mean: mean(pairs.map(pair => pair.scored.find(item => item.condition === "outcome_shuffled_practice").score[endpoint])),
      paired_mean_difference: mean(differences), one_sided_exact_p: exactPairedPermutationPValue(differences),
      pair_differences: differences };
  }
  const artifact = { schema: "ik.deep-practice-batch.v1", preregistration_sha256: sha256(fs.readFileSync(preregistrationPath)),
    completed_at: new Date().toISOString(), pair_count: pairs.length, endpoint_results: endpointResults, pairs,
    interpretation_boundary: JSON.parse(fs.readFileSync(preregistrationPath, "utf8")).interpretation_boundary };
  fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (!fs.existsSync(preregistrationPath)) throw new Error("sealed preregistration is missing");
if (process.argv.includes("--validate-only")) {
  const sealed = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
  const source = JSON.parse(fs.readFileSync(sourceArtifactPath, "utf8"));
  const sourceRequests = fs.readdirSync(path.join(path.dirname(sourceArtifactPath), "requests")).filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(fs.readFileSync(path.join(path.dirname(sourceArtifactPath), "requests", name), "utf8")));
  if (JSON.stringify(sealed.randomization.schedule) !== JSON.stringify(schedule)) throw new Error("schedule differs from sealed preregistration");
  if (heldoutSteps.length !== 20 || source.practice_episodes.length !== 5) throw new Error("sample counts differ from preregistration");
  if (practiceSteps.some((_, index) => !sourceRequests.some(item => item.summary?.kind === `practice-${index + 1}_baseline`))) {
    throw new Error("source practice requests are incomplete");
  }
  console.log(JSON.stringify({ valid: true, heldout_pairs: heldoutSteps.length,
    practice_episodes: source.practice_episodes.length, preregistration_sha256: sha256(fs.readFileSync(preregistrationPath)) }));
  process.exit(0);
}
const ledger = new RequestLedger({ baseUrl, runId: PROTOCOL.run_id });
await ledger.initialize(); await waitForReady();
const practiceEpisodes = await preparePractice(ledger);
let completedThisInvocation = 0;
for (const item of schedule) {
  const pairPath = path.join(outputDir, `pair-${String(item.heldout_index + 1).padStart(2, "0")}.json`);
  if (fs.existsSync(pairPath)) continue;
  if (completedThisInvocation >= requestedCount) break;
  const pair = await runPair(item, practiceEpisodes, ledger);
  fs.writeFileSync(pairPath, `${JSON.stringify(pair, null, 2)}\n`);
  completedThisInvocation += 1;
  console.log(JSON.stringify({ completed_pair: item.heldout_index + 1, completed_this_invocation: completedThisInvocation }));
}
ledger.exportTo(outputDir);
const artifact = assemble();
console.log(JSON.stringify({ run_id: PROTOCOL.run_id, completed_this_invocation: completedThisInvocation,
  total_pair_files: fs.readdirSync(outputDir).filter(name => /^pair-\d\d\.json$/.test(name)).length,
  complete: Boolean(artifact), endpoint_results: artifact?.endpoint_results ?? null }));
