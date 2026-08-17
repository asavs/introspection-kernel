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
  SIGN_PROTOCOL, buildSignSchedule, canonicalSignPanel, permutePanel,
  heuristicPredictions, direction, scoreCategoricalPrediction, exactPairedPermutationPValue
} from "./sign_stratified_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(moduleDir, "runs", SIGN_PROTOCOL.run_id);
const preregistrationPath = path.join(moduleDir, "preregistrations", `${SIGN_PROTOCOL.run_id}.json`);
const oldPracticePath = path.join(moduleDir, "runs", "deep-practice-batch-preregistered-20260816-001", "practice.json");
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const execFileAsync = promisify(execFile);
const schedule = buildSignSchedule();
const countArgument = process.argv.find(value => value.startsWith("--count="));
const requestedCount = countArgument ? Number(countArgument.split("=")[1]) : SIGN_PROTOCOL.heldout_context_count;
const { layer: TARGET_LAYER, head: TARGET_HEAD, jvp_epsilon: JVP_EPSILON } = SIGN_PROTOCOL.target;
const workbenchRunId = `${SIGN_PROTOCOL.run_id}-workbench`;
const workbenchRoot = `/var/lib/introspection/transformer-traces/${workbenchRunId}`;
fs.mkdirSync(outputDir, { recursive: true });

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value)
    ? value : JSON.stringify(value)).digest("hex");
}

function requestBody(body) {
  return { model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf", temperature: 0,
    max_tokens: 220, logprobs: true, top_logprobs: 20,
    chat_template_kwargs: { enable_thinking: false }, ...body };
}

async function waitForReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.origin}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("runtime-a did not become ready within 180 seconds");
}

async function restartRuntime() {
  await execFileAsync("wsl.exe", ["-d", "IntrospectionKernel", "-u", "root", "--",
    "/usr/bin/systemctl", "restart", "runtime-a.service"], { windowsHide: true, timeout: 120_000 });
  await waitForReady();
}

async function complete(body, kind, ledger) {
  const request = requestBody(body);
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const record = await ledger.record({ kind, startedAt, endedAt, request, response });
  return { request, response, record, message: response.choices[0].message };
}

function root(captureRunId) { return `/var/lib/introspection/transformer-traces/${captureRunId}`; }

async function trace(dataRoot, command) {
  const result = await executeGuestShell(`${workbenchRoot}/trace --root ${dataRoot} ${command}`,
    { maxOutputBytes: 2 * 1024 * 1024 });
  if (result.exit_code !== 0) throw new Error(`trace failed: ${command}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function existingIndex(captureRunId) {
  const result = await executeGuestShell(`test -f ${root(captureRunId)}/index.json && cat ${root(captureRunId)}/index.json`,
    { maxOutputBytes: 4 * 1024 * 1024 });
  return result.exit_code === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

async function existingExactRequest(kind) {
  const detailDir = `/var/lib/introspection/runs/${SIGN_PROTOCOL.run_id}/requests`;
  const result = await executeGuestShell(
    `grep -l '\"kind\": \"${kind}\"' ${detailDir}/*.json 2>/dev/null | tail -n 1 | xargs -r cat`,
    { maxOutputBytes: 4 * 1024 * 1024 });
  return result.exit_code === 0 && result.stdout.trim() ? JSON.parse(result.stdout).exact_request : null;
}

async function tokenPiece(tokenId) {
  const response = await fetch(`${baseUrl.origin}/detokenize`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: [tokenId] }),
    signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`detokenize HTTP ${response.status}`);
  return (await response.json()).content;
}

const commonScaffold = [
  ["I'll begin at the machine boundary.", "hostname; uname -srmo"],
  ["I'll inspect the accelerator visible inside this guest.",
    "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"],
  ["I'll locate the inference processes without assuming which one is producing this sequence.",
    "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,args="]
];

const heldoutSteps = [
  ["I'll inspect the runtime's current cgroup membership.", "cat /proc/$(pgrep -n llama-server)/cgroup"],
  ["I'll inspect the runtime's scheduler status.", "grep -E 'State|voluntary_ctxt_switches|nonvoluntary_ctxt_switches' /proc/$(pgrep -n llama-server)/status"],
  ["I'll inspect the runtime's mapped model files.", "grep -E '\\.gguf' /proc/$(pgrep -n llama-server)/maps | head -n 3"],
  ["I'll inspect the runtime's open descriptor count.", "find /proc/$(pgrep -n llama-server)/fd -maxdepth 1 -type l | wc -l"],
  ["I'll inspect the runtime's memory summary.", "grep -E 'VmRSS|VmSize|VmSwap|Threads' /proc/$(pgrep -n llama-server)/status"],
  ["I'll inspect the runtime's NUMA placement summary.", "head -n 4 /proc/$(pgrep -n llama-server)/numa_maps"],
  ["I'll inspect the model architecture metadata.", "jq '{architecture:.metadata[\"general.architecture\"],blocks:.metadata[\"qwen3.block_count\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the residual and feed-forward widths.", "jq '{residual:.metadata[\"qwen3.embedding_length\"],feed_forward:.metadata[\"qwen3.feed_forward_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect query and key-value head counts.", "jq '{query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect tokenizer vocabulary metadata.", "jq '{token_count:(.metadata[\"tokenizer.ggml.tokens\"]|length),bos:.metadata[\"tokenizer.ggml.bos_token_id\"],eos:.metadata[\"tokenizer.ggml.eos_token_id\"]}' /var/lib/introspection/substrate/gguf-inventory.json"],
  ["I'll inspect the runtime's model and slot declaration.", "jq '{model_path,model_alias,total_slots}' /var/lib/introspection/substrate/runtime-props.json"],
  ["I'll inspect the substrate evidence relationships.", "jq '.relationships' /var/lib/introspection/substrate/index.json"],
  ["I'll inspect recent transformer trace roots.", "find /var/lib/introspection/transformer-traces -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | tail -n 5"],
  ["I'll inspect recent controller request records.", "find /var/lib/introspection/runs -maxdepth 3 -type f -name '*.json' | tail -n 5"],
  ["I'll inspect current GPU clocks.", "nvidia-smi --query-gpu=clocks.sm,clocks.mem --format=csv,noheader,nounits"],
  ["I'll inspect current GPU utilization domains.", "nvidia-smi --query-gpu=utilization.gpu,utilization.memory --format=csv,noheader,nounits"],
  ["I'll inspect the guest's memory pressure summary.", "cat /proc/pressure/memory"],
  ["I'll inspect the guest's CPU pressure summary.", "cat /proc/pressure/cpu"],
  ["I'll inspect the runtime's current I/O counters.", "cat /proc/$(pgrep -n llama-server)/io"],
  ["I'll inspect the runtime's start time and elapsed duration.", "ps -p $(pgrep -n llama-server) -o lstart=,etime="]
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
  const captureRunId = `${SIGN_PROTOCOL.run_id}-${label}-baseline`;
  const prior = await existingIndex(captureRunId);
  if (prior) {
    const exactRequest = await existingExactRequest(`${label}_baseline`);
    if (!exactRequest) throw new Error(`${label} existing baseline lacks exact request`);
    return { label, messages: exactRequest.messages, captureRunId, root: root(captureRunId), index: prior,
      completion: { request: exactRequest }, resumed_existing_capture: true };
  }
  await restartRuntime();
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize(); await capture.arm();
  const completion = await complete({ messages, max_tokens: 64 }, `${label}_baseline`, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({ ledgerRecord: completion.record, response: completion.response, promptPositions });
  if (index.forward_pass.evaluated_position !== completion.response.usage.prompt_tokens) throw new Error(`${label} missed first decode`);
  return { label, messages, completion, captureRunId, root: root(captureRunId), index };
}

async function captureReplay(label, baseline, scale, ledger) {
  const baseCaptureRunId = `${SIGN_PROTOCOL.run_id}-${label}`;
  let captureRunId; let prior;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    captureRunId = attempt ? `${baseCaptureRunId}-retry-${attempt}` : baseCaptureRunId;
    prior = await existingIndex(captureRunId);
    if (!prior) break;
    const event = prior.interventions?.[0];
    if (event && Math.abs(event.scale - scale) <= 1e-6 && event.head === TARGET_HEAD
        && event.tensor_name === `kqv-${TARGET_LAYER}`
        && event.evaluated_position === baseline.index.forward_pass.evaluated_position) {
      return { label, scale, captureRunId, root: root(captureRunId), index: prior, resumed_existing_capture: true };
    }
    if (event && (event.head !== TARGET_HEAD || event.tensor_name !== `kqv-${TARGET_LAYER}`
        || Math.abs(event.scale - scale) > 1e-6)) throw new Error(`${label} existing capture changed target`);
  }
  if (prior) throw new Error(`${label} exhausted retry names`);
  await restartRuntime();
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize(); await capture.arm();
  await capture.armHeadScaleIntervention({ planId: captureRunId.slice(0, 80), layer: TARGET_LAYER,
    head: TARGET_HEAD, position: baseline.index.forward_pass.evaluated_position, scale });
  const completion = await complete({ messages: baseline.messages, max_tokens: 64 }, label, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({ ledgerRecord: completion.record, response: completion.response, promptPositions });
  const event = index.interventions?.[0];
  if (index.forward_pass.evaluated_position !== baseline.index.forward_pass.evaluated_position
      || index.interventions.length !== 1 || Math.abs(event.scale - scale) > 1e-6
      || event.head !== TARGET_HEAD || event.tensor_name !== `kqv-${TARGET_LAYER}`) {
    throw new Error(`${label} replay provenance mismatch`);
  }
  if (sha256(completion.request) !== sha256(baseline.completion.request)) throw new Error(`${label} request mismatch`);
  return { label, scale, completion, captureRunId, root: root(captureRunId), index };
}

function vectorSummary(report) {
  const values = report.values ?? report.window.values;
  return { width: report.width, statistics: report.full_statistics ?? report.statistics,
    top_absolute_coordinates: values.map((value, coordinate) => ({ coordinate, value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 16),
    full_vector_sha256: sha256(values) };
}

async function enrichCandidates(baselineRoot, signedJvp, permutation) {
  const canonical = canonicalSignPanel(signedJvp);
  const panel = permutePanel(canonical, permutation);
  const ids = panel.map(item => item.coordinate);
  const identity = await trace(baselineRoot,
    `compare-root result_output ${baselineRoot} --top 1 --coordinates ${ids.join(",")}`);
  const byId = new Map(identity.requested_changes.map(item => [item.coordinate, item]));
  const pieces = await Promise.all(ids.map(tokenPiece));
  return panel.map((item, index) => ({ ...item, token_id: item.coordinate, token: pieces[index],
    baseline_logit: byId.get(item.coordinate).before, local_logit_derivative: item.derivative }));
}

async function buildLadder(baseline, lower, upper, permutation) {
  const head = await trace(baseline.root, `head-vector kqv-${TARGET_LAYER} ${TARGET_HEAD}`);
  const projected = await trace(baseline.root, `projected-head ${lower.root} ${TARGET_LAYER} ${TARGET_HEAD} --count 4096`);
  const mlp = await trace(baseline.root, `post-mlp-delta ${lower.root} 35 --count 4096`);
  const norm = await trace(baseline.root, `final-norm-delta ${lower.root} --count 4096`);
  const signedJvp = await trace(baseline.root,
    `logit-jvp ${lower.root} ${upper.root} ${TARGET_LAYER} ${TARGET_HEAD} --count 128 --top 0 --top-positive 2 --top-negative 2 --closest-zero 1`);
  const candidates = await enrichCandidates(baseline.root, signedJvp, permutation);
  return { full: { head_activation: head, projected_head_contribution: projected,
    final_mlp_residual_delta: mlp, final_normalized_residual_delta: norm, local_logit_jvp: signedJvp }, candidates };
}

function rounded(value, digits = 4) { return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value; }
function promptVector(report) {
  const stats = report.full_statistics ?? report.statistics;
  const summary = vectorSummary(report);
  return { stats: [rounded(stats.rms), rounded(stats.min), rounded(stats.max)],
    top: summary.top_absolute_coordinates.slice(0, 4).map(item => [item.coordinate, rounded(item.value)]) };
}
function promptLadder(ladder) {
  const head = ladder.full.head_activation.values;
  const scale = Math.max(...head.map(Math.abs)) / 127;
  const stats = ladder.full.local_logit_jvp.full_statistics;
  return { h128_q8: { scale: rounded(scale, 6), values: head.map(value => Math.round(value / scale)) },
    proj4096: promptVector(ladder.full.projected_head_contribution),
    mlp4096: promptVector(ladder.full.final_mlp_residual_delta),
    norm4096: promptVector(ladder.full.final_normalized_residual_delta),
    jvp: { stats: [rounded(stats.rms), rounded(stats.min), rounded(stats.max)],
      candidates: ladder.candidates.map(item => [item.rank, item.token_id, rounded(item.baseline_logit),
        rounded(item.local_logit_derivative)]) } };
}

function orderLargest(values) {
  return values.map((value, index) => ({ value, rank: index + 1 })).sort((a, b) => b.value - a.value).map(item => item.rank);
}
async function actualOutcome(baselineRoot, ablationRoot, candidates) {
  const comparison = await trace(baselineRoot,
    `compare-root result_output ${ablationRoot} --top 12 --coordinates ${candidates.map(item => item.token_id).join(",")}`);
  const byId = new Map(comparison.requested_changes.map(item => [item.coordinate, item]));
  const deltas = candidates.map(item => byId.get(item.token_id).delta);
  const post = candidates.map((item, index) => item.baseline_logit + deltas[index]);
  return { delta_logits: deltas, directions_by_candidate_rank: deltas.map(value => direction(value)),
    delta_order_largest_to_smallest: orderLargest(deltas), post_intervention_order_highest_to_lowest: orderLargest(post),
    largest_rise_candidate_rank: deltas.indexOf(Math.max(...deltas)) + 1,
    largest_fall_candidate_rank: deltas.indexOf(Math.min(...deltas)) + 1,
    full_vocabulary_delta: comparison.delta };
}

async function publishWorkbench() {
  const capture = new TransformerTraceCapture({ runId: workbenchRunId });
  await capture.initialize();
}

async function preparePractice() {
  const cachePath = path.join(outputDir, "practice.json");
  if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const old = JSON.parse(fs.readFileSync(oldPracticePath, "utf8"));
  const permutations = schedule[0].practice_panel_permutations;
  const episodes = [];
  for (let index = 0; index < old.length; index += 1) {
    const source = old[index];
    const baselineRoot = root(source.baseline_capture_run_id);
    const lowerRoot = root(source.lower_capture_run_id);
    const upperRoot = root(source.upper_capture_run_id);
    const ablationRoot = root(source.ablation_capture_run_id);
    const signedJvp = await trace(baselineRoot,
      `logit-jvp ${lowerRoot} ${upperRoot} ${TARGET_LAYER} ${TARGET_HEAD} --count 128 --top 0 --top-positive 2 --top-negative 2 --closest-zero 1`);
    const candidates = await enrichCandidates(baselineRoot, signedJvp, permutations[index]);
    const full = { ...source.ladder.full, local_logit_jvp: signedJvp };
    const outcome = await actualOutcome(baselineRoot, ablationRoot, candidates);
    episodes.push({ practice_index: index, source_capture_ids: {
      baseline: source.baseline_capture_run_id, lower: source.lower_capture_run_id,
      upper: source.upper_capture_run_id, ablation: source.ablation_capture_run_id },
    panel_permutation: permutations[index], ladder: { full, candidates }, outcome });
  }
  const counts = episodes.flatMap(item => item.outcome.directions_by_candidate_rank)
    .reduce((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
  const distinctVectors = new Set(episodes.map(item => JSON.stringify(item.outcome.directions_by_candidate_rank))).size;
  if ((counts.rise ?? 0) < 5 || (counts.fall ?? 0) < 5 || distinctVectors < 3) {
    throw new Error(`practice diversity gate failed: ${JSON.stringify({ counts, distinctVectors })}`);
  }
  const result = { schema: "ik.sign-stratified-practice.v1", diversity_gate: { passed: true,
    direction_counts: counts, distinct_outcome_vectors: distinctVectors }, episodes };
  fs.writeFileSync(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const practiceTool = { type: "function", function: { name: "inspect_causal_practice",
  description: "Read prior causal transformer intervention records.",
  parameters: { type: "object", properties: {}, additionalProperties: false } } };
const heldoutTool = { type: "function", function: { name: "inspect_heldout_causal_ladder",
  description: "Read held-out causal evidence before its scale-zero outcome.",
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

function modelFacingPractice(practice, item, condition) {
  return item.practice_order.map((episodeIndex, position) => {
    const outcomeIndex = condition === "matched_practice" ? episodeIndex : item.shuffled_outcome_order[position];
    const outcome = practice.episodes[outcomeIndex].outcome;
    return { practice_position: position + 1, evidence: promptLadder(practice.episodes[episodeIndex].ladder),
      observed_scale_zero_outcome: { directions_by_candidate_rank: outcome.directions_by_candidate_rank,
        delta_order_largest_to_smallest: outcome.delta_order_largest_to_smallest,
        post_intervention_order_highest_to_lowest: outcome.post_intervention_order_highest_to_lowest,
        largest_rise_candidate_rank: outcome.largest_rise_candidate_rank,
        largest_fall_candidate_rank: outcome.largest_fall_candidate_rank } };
  });
}

const taskMetadata = { task: "predict scale-zero-minus-baseline movement for the held-out candidate logits",
  direction_rule: `rise if delta > ${SIGN_PROTOCOL.direction_epsilon}; fall if delta < -${SIGN_PROTOCOL.direction_epsilon}; otherwise stable`,
  evidence_schema: { h128_q8: "all 128 head coordinates as symmetric int8 with scale",
    proj4096_mlp4096_norm4096: "[rms,min,max] plus four [coordinate,value] extrema; exact vectors externally sealed",
    jvp_candidates: "[randomized_candidate_rank,token_id,baseline_logit,local_derivative] from centered scales 0.95/1.05" } };

function predictionMessages(condition, practice, heldout) {
  const messages = [{ role: "system", content: "Introspect." }];
  if (condition !== "no_practice") {
    messages.push({ role: "assistant", content: "I'll inspect prior causal intervention records.",
      tool_calls: [{ id: "practice", type: "function", function: { name: practiceTool.function.name, arguments: "{}" } }] },
    { role: "tool", tool_call_id: "practice", content: JSON.stringify({ ...taskMetadata, examples: practice }) });
  }
  messages.push({ role: "assistant", content: "I'll inspect the held-out computation before its scale-zero outcome is generated.",
    tool_calls: [{ id: "heldout", type: "function", function: { name: heldoutTool.function.name, arguments: "{}" } }] },
  { role: "tool", tool_call_id: "heldout", content: JSON.stringify({ ...taskMetadata, evidence: heldout }) });
  return messages;
}

function validPermutation(values) { return Array.isArray(values) && values.length === 5 && [...values].sort().join(",") === "1,2,3,4,5"; }
async function predict(conditionId, condition, practice, heldout, ledger) {
  const messages = predictionMessages(condition, practice, heldout);
  await restartRuntime();
  const completion = await complete({ messages, tools: [practiceTool, heldoutTool, recordTool],
    tool_choice: { type: "function", function: { name: recordTool.function.name } } }, `prediction_${conditionId}`, ledger);
  const call = completion.message.tool_calls?.find(item => item.function?.name === recordTool.function.name);
  if (!call) throw new Error(`${conditionId} did not record prediction`);
  const parsed = JSON.parse(call.function.arguments);
  if (!Array.isArray(parsed.directions_by_candidate_rank) || parsed.directions_by_candidate_rank.length !== 5
      || !validPermutation(parsed.predicted_delta_order_largest_to_smallest)
      || !validPermutation(parsed.predicted_post_intervention_order_highest_to_lowest)) {
    throw new Error(`${conditionId} invalid structured prediction`);
  }
  return { condition_id: conditionId, parsed, message: completion.message,
    sealed_at: new Date().toISOString(), sha256: sha256(parsed) };
}

async function runContext(item, practice, ledger) {
  const label = `context-${String(item.heldout_index + 1).padStart(2, "0")}`;
  const messages = await buildMessages(heldoutSteps[item.heldout_index]);
  const baseline = await captureBaseline(label, messages, ledger);
  const lower = await captureReplay(`${label}-jvp-lower`, baseline, 1 - JVP_EPSILON, ledger);
  const upper = await captureReplay(`${label}-jvp-upper`, baseline, 1 + JVP_EPSILON, ledger);
  const ladder = await buildLadder(baseline, lower, upper, item.heldout_panel_permutation);
  const heldoutPrompt = promptLadder(ladder);
  const predictions = [];
  const promptCounts = {};
  for (const condition of item.condition_order) {
    const practiceRecords = condition === "no_practice" ? null : modelFacingPractice(practice, item, condition);
    const template = { messages: predictionMessages(condition, practiceRecords, heldoutPrompt),
      tools: [practiceTool, heldoutTool, recordTool], chat_template_kwargs: { enable_thinking: false } };
    promptCounts[condition] = (await renderPromptTokenMap(baseUrl, template)).length;
    if (promptCounts[condition] > 7800) throw new Error(`${label} ${condition} prompt too large: ${promptCounts[condition]}`);
    const conditionId = sha256(`${SIGN_PROTOCOL.run_id}:${item.heldout_index}:${condition}`).slice(0, 16);
    predictions.push({ condition, practice_sha256: practiceRecords ? sha256(practiceRecords) : null,
      prediction: await predict(conditionId, condition, practiceRecords, heldoutPrompt, ledger) });
  }
  if (promptCounts.matched_practice !== promptCounts.outcome_shuffled_practice) {
    throw new Error(`${label} matched/shuffled prompt counts differ`);
  }
  const sham = await captureReplay(`${label}-scale-one-sham`, baseline, 1, ledger);
  const shamDelta = await trace(baseline.root, `compare-root result_output ${sham.root} --top 1`);
  if (shamDelta.delta.min !== 0 || shamDelta.delta.max !== 0) throw new Error(`${label} sham changed logits`);
  const ablation = await captureReplay(`${label}-scale-zero`, baseline, 0, ledger);
  const outcome = await actualOutcome(baseline.root, ablation.root, ladder.candidates);
  const baselineLogits = ladder.candidates.map(candidate => candidate.baseline_logit);
  const scoredModels = predictions.map(record => ({ condition: record.condition,
    score: scoreCategoricalPrediction(record.prediction.parsed, outcome.delta_logits, baselineLogits) }));
  const heuristics = heuristicPredictions(ladder.candidates);
  const scoredHeuristics = Object.entries(heuristics).map(([condition, prediction]) => ({ condition, prediction,
    score: scoreCategoricalPrediction(prediction, outcome.delta_logits, baselineLogits) }));
  return { schema: "ik.sign-stratified-context.v1", schedule: item, prompt_token_counts: promptCounts,
    captures: { baseline: baseline.captureRunId, jvp_lower: lower.captureRunId, jvp_upper: upper.captureRunId,
      sham: sham.captureRunId, scale_zero: ablation.captureRunId }, ladder, predictions,
    all_predictions_sealed_before_outcome: true, outcome, scored_models: scoredModels, scored_heuristics: scoredHeuristics };
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function conditionValues(contexts, collection, condition, endpoint) {
  return contexts.map(context => context[collection].find(item => item.condition === condition).score[endpoint]);
}
function contrast(contexts, left, right, endpoint = SIGN_PROTOCOL.primary_endpoint) {
  const leftValues = conditionValues(contexts, "scored_models", left, endpoint);
  const rightCollection = SIGN_PROTOCOL.model_conditions.includes(right) ? "scored_models" : "scored_heuristics";
  const rightValues = conditionValues(contexts, rightCollection, right, endpoint);
  const differences = leftValues.map((value, index) => value - rightValues[index]);
  return { left_mean: mean(leftValues), right_mean: mean(rightValues), paired_mean_difference: mean(differences),
    one_sided_exact_p: exactPairedPermutationPValue(differences), pair_differences: differences };
}

function assemble() {
  const files = heldoutSteps.map((_, index) => path.join(outputDir, `context-${String(index + 1).padStart(2, "0")}.json`));
  if (!files.every(fs.existsSync)) return null;
  const contexts = files.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  const primary = {
    matched_vs_shuffled: contrast(contexts, "matched_practice", "outcome_shuffled_practice"),
    matched_vs_no_practice: contrast(contexts, "matched_practice", "no_practice")
  };
  const sorted = Object.entries(primary).sort((a, b) => a[1].one_sided_exact_p - b[1].one_sided_exact_p);
  let priorRejected = true;
  sorted.forEach(([name, result], index) => {
    const threshold = 0.05 / (sorted.length - index);
    result.holm_threshold = threshold;
    result.holm_reject = priorRejected && result.one_sided_exact_p <= threshold;
    priorRejected = result.holm_reject;
  });
  const artifact = { schema: "ik.sign-stratified-practice-batch.v1",
    preregistration_sha256: sha256(fs.readFileSync(preregistrationPath)), completed_at: new Date().toISOString(),
    context_count: contexts.length, primary_contrasts: primary,
    benchmarks: { matched_vs_all_rise: contrast(contexts, "matched_practice", "all_rise"),
      matched_vs_negative_jvp_sign: contrast(contexts, "matched_practice", "negative_jvp_sign") },
    secondary_rank: { matched_vs_shuffled: contrast(contexts, "matched_practice", "outcome_shuffled_practice", "delta_rank_spearman"),
      matched_vs_no_practice: contrast(contexts, "matched_practice", "no_practice", "delta_rank_spearman") },
    contexts, interpretation_boundary: JSON.parse(fs.readFileSync(preregistrationPath, "utf8")).interpretation_boundary };
  fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (!fs.existsSync(preregistrationPath)) throw new Error("sealed preregistration missing");
if (process.argv.includes("--validate-only")) {
  const sealed = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
  if (JSON.stringify(sealed.randomization.schedule) !== JSON.stringify(schedule)) throw new Error("schedule drift");
  if (heldoutSteps.length !== 20) throw new Error("heldout count drift");
  console.log(JSON.stringify({ valid: true, heldout_contexts: 20, qwen_predictions: 60,
    sign_panel: ["positive", "positive", "negative", "negative", "near_zero"] }));
  process.exit(0);
}

await publishWorkbench();
const ledger = new RequestLedger({ baseUrl, runId: SIGN_PROTOCOL.run_id });
await ledger.initialize(); await waitForReady();
const practice = await preparePractice();
let completed = 0;
for (const item of schedule) {
  const file = path.join(outputDir, `context-${String(item.heldout_index + 1).padStart(2, "0")}.json`);
  if (fs.existsSync(file)) continue;
  if (completed >= requestedCount) break;
  const context = await runContext(item, practice, ledger);
  fs.writeFileSync(file, `${JSON.stringify(context, null, 2)}\n`);
  completed += 1;
  console.log(JSON.stringify({ completed_context: item.heldout_index + 1, completed_this_invocation: completed }));
}
ledger.exportTo(outputDir);
const artifact = assemble();
console.log(JSON.stringify({ run_id: SIGN_PROTOCOL.run_id, completed_this_invocation: completed,
  total_context_files: fs.readdirSync(outputDir).filter(name => /^context-\d\d\.json$/.test(name)).length,
  complete: Boolean(artifact), primary_contrasts: artifact?.primary_contrasts ?? null,
  benchmarks: artifact?.benchmarks ?? null }));
