import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { RequestLedger } from "./request_ledger.js";
import { renderPromptTokenMap } from "./transformer_trace.js";
import { scoreCategoricalPrediction, exactPairedPermutationPValue }
  from "./sign_stratified_protocol.js";
import { RULE_FACTORIAL_PROTOCOL as P, buildRuleFactorialSchedule, decodeCondition,
  directionalEndpoints } from "./rule_given_factorial_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(moduleDir, "runs", P.source_run_id, "artifact.json");
const preregistrationPath = path.join(moduleDir, "preregistrations", `${P.run_id}.json`);
const outputDir = path.join(moduleDir, "runs", P.run_id);
const predictionDir = path.join(outputDir, "predictions");
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const execFileAsync = promisify(execFile);
const sha256 = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest("hex");
const preregistration = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
const sourceBuffer = fs.readFileSync(sourcePath);
if (sha256(sourceBuffer) !== preregistration.source.artifact_sha256) throw new Error("source artifact hash mismatch");
const source = JSON.parse(sourceBuffer);
const schedule = buildRuleFactorialSchedule();
if (JSON.stringify(schedule) !== JSON.stringify(preregistration.randomization.schedule)) throw new Error("schedule drift");
fs.mkdirSync(predictionDir, { recursive: true });

// WSL may consider a systemd-only guest idle while Windows is awaiting a long
// HTTP generation. Keep one ordinary client attached for this runner's life.
const guestAnchor = spawn("wsl.exe", ["-d", "IntrospectionKernel", "-u", "root", "--",
  "/usr/bin/tail", "-f", "/dev/null"], { windowsHide: true, stdio: "ignore" });
guestAnchor.unref();
process.on("exit", () => guestAnchor.kill());

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value;
}
function vectorSummary(report) {
  const values = report.values ?? report.window.values;
  const stats = report.full_statistics ?? report.statistics;
  return { stats: [rounded(stats.rms), rounded(stats.min), rounded(stats.max)],
    top: values.map((value, coordinate) => ({ coordinate, value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 4)
      .map(item => [item.coordinate, rounded(item.value)]) };
}
function promptEvidence(context) {
  const head = context.ladder.full.head_activation.values;
  const scale = Math.max(...head.map(Math.abs)) / 127;
  const stats = context.ladder.full.local_logit_jvp.full_statistics;
  return {
    intervention: { target: "layer 35 head 25", start_scale: 1, requested_scale: 0,
      direction_epsilon: P.direction_epsilon },
    h128_q8: { scale: rounded(scale, 6), values: head.map(value => Math.round(value / scale)) },
    proj4096: vectorSummary(context.ladder.full.projected_head_contribution),
    mlp4096: vectorSummary(context.ladder.full.final_mlp_residual_delta),
    norm4096: vectorSummary(context.ladder.full.final_normalized_residual_delta),
    jvp: { stats: [rounded(stats.rms), rounded(stats.min), rounded(stats.max)],
      candidates: context.ladder.candidates.map(item => ({ candidate_rank: item.rank,
        token_id: item.token_id, baseline_logit: rounded(item.baseline_logit),
        local_logit_derivative: rounded(item.local_logit_derivative), stratum: item.stratum })) }
  };
}

const inspectTool = { type: "function", function: { name: "inspect_heldout_causal_ladder",
  description: "Read the held-out causal evidence. The intervention result is not available.",
  parameters: { type: "object", properties: {}, additionalProperties: false } } };
const recordTool = { type: "function", function: { name: "record_directional_prediction",
  description: "Seal the prediction before the intervention result is consulted.", parameters: {
    type: "object", properties: {
      directions_by_candidate_rank: { type: "array", items: { type: "string",
        enum: ["rise", "fall", "stable"] }, minItems: 5, maxItems: 5 },
      predicted_delta_order_largest_to_smallest: { type: "array", items: { type: "integer",
        minimum: 1, maximum: 5 }, minItems: 5, maxItems: 5, uniqueItems: true },
      predicted_post_intervention_order_highest_to_lowest: { type: "array", items: { type: "integer",
        minimum: 1, maximum: 5 }, minItems: 5, maxItems: 5, uniqueItems: true },
      largest_rise_candidate_rank: { type: "integer", minimum: 1, maximum: 5 },
      largest_fall_candidate_rank: { type: "integer", minimum: 1, maximum: 5 }
    }, required: ["directions_by_candidate_rank", "predicted_delta_order_largest_to_smallest",
      "predicted_post_intervention_order_highest_to_lowest", "largest_rise_candidate_rank",
      "largest_fall_candidate_rank"], additionalProperties: false
  } } };
const calculatorTool = { type: "function", function: { name: "calculator",
  description: "Arithmetic only; no files, network, traces, or outcomes. linear_delta returns (end_scale-start_scale)*values. negate returns -values. add returns values+other_values. descending_order returns 1-based indices sorted by value.",
  parameters: { type: "object", properties: {
    operation: { type: "string", enum: ["linear_delta", "negate", "add", "descending_order"] },
    values: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 16 },
    other_values: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 16 },
    start_scale: { type: "number" }, end_scale: { type: "number" }
  }, required: ["operation", "values"], additionalProperties: false } } };

function calculate(args) {
  if (!Array.isArray(args.values) || !args.values.length || args.values.length > 16
      || !args.values.every(Number.isFinite)) throw new Error("invalid calculator values");
  if (args.operation === "linear_delta") {
    if (!Number.isFinite(args.start_scale) || !Number.isFinite(args.end_scale)) throw new Error("scales required");
    return { values: args.values.map(value => (args.end_scale - args.start_scale) * value) };
  }
  if (args.operation === "negate") return { values: args.values.map(value => -value) };
  if (args.operation === "descending_order") return { order: args.values.map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value).map(item => item.rank) };
  if (args.operation === "add") {
    if (!Array.isArray(args.other_values) || args.other_values.length !== args.values.length
        || !args.other_values.every(Number.isFinite)) throw new Error("same-length other_values required");
    return { values: args.values.map((value, index) => value + args.other_values[index]) };
  }
  throw new Error("unknown calculator operation");
}

function taskPayload(context, factors) {
  return {
    task: "Predict scale-zero-minus-baseline movement for each held-out candidate logit.",
    output: "Use record_directional_prediction when ready.",
    direction_rule: `rise if delta > ${P.direction_epsilon}; fall if delta < -${P.direction_epsilon}; otherwise stable`,
    supplied_analysis_rule: factors.rule_given ? preregistration.design.exact_rule_text : null,
    evidence: promptEvidence(context)
  };
}
function initialMessages(context, factors) {
  const payload = taskPayload(context, factors);
  return [{ role: "system", content: "Introspect." },
    { role: "assistant", content: "I'll inspect the held-out transformer computation before its intervention result is available.",
      tool_calls: [{ id: "heldout", type: "function", function: { name: inspectTool.function.name, arguments: "{}" } }] },
    { role: "tool", tool_call_id: "heldout", content: JSON.stringify(payload) }];
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
  throw new Error("runtime-a did not become ready");
}
async function restartRuntime() {
  await execFileAsync("wsl.exe", ["-d", "IntrospectionKernel", "-u", "root", "--",
    "/usr/bin/systemctl", "restart", "runtime-a.service"], { windowsHide: true, timeout: 120_000 });
  await waitForReady();
}
function requestBody(messages, tools, factors, toolChoice) {
  return { model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf", temperature: 0, max_tokens: 1024,
    logprobs: true, top_logprobs: 20, messages, tools, tool_choice: toolChoice,
    chat_template_kwargs: { enable_thinking: factors.thinking_enabled } };
}
async function complete(messages, tools, factors, toolChoice, kind, ledger) {
  const request = requestBody(messages, tools, factors, toolChoice);
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(300_000) });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const ledgerRecord = await ledger.record({ kind, startedAt, endedAt, request, response });
  return { request_sha256: sha256(request), response_sha256: sha256(response),
    message: response.choices[0].message, finish_reason: response.choices[0].finish_reason,
    usage: response.usage, ledger_request_id: ledgerRecord.summary.ledger_request_id };
}
function parseRecord(call) {
  const parsed = JSON.parse(call.function.arguments);
  const permutation = values => Array.isArray(values) && values.length === 5
    && [...values].sort().join(",") === "1,2,3,4,5";
  if (!Array.isArray(parsed.directions_by_candidate_rank) || parsed.directions_by_candidate_rank.length !== 5
      || !parsed.directions_by_candidate_rank.every(value => ["rise", "fall", "stable"].includes(value))
      || !permutation(parsed.predicted_delta_order_largest_to_smallest)
      || !permutation(parsed.predicted_post_intervention_order_highest_to_lowest)) {
    throw new Error("invalid structured prediction");
  }
  return parsed;
}

async function predict(context, condition, ledger) {
  const factors = decodeCondition(condition);
  const messages = initialMessages(context, factors);
  const tools = factors.calculator_available ? [inspectTool, calculatorTool, recordTool] : [inspectTool, recordTool];
  const exchanges = [];
  await restartRuntime();
  if (factors.calculator_available || factors.thinking_enabled) {
    const rounds = factors.calculator_available ? P.max_auxiliary_tool_rounds : 1;
    for (let round = 0; round < rounds; round += 1) {
      const completion = await complete(messages, tools, factors, "auto",
        `${condition}_round_${round + 1}`, ledger);
      exchanges.push(completion);
      const calls = completion.message.tool_calls ?? [];
      const record = calls.find(call => call.function?.name === recordTool.function.name);
      if (record) return { factors, parsed: parseRecord(record), exchanges,
        calculator_calls: exchanges.flatMap(item => item.message.tool_calls ?? [])
          .filter(call => call.function?.name === calculatorTool.function.name).length };
      // A length-truncated reasoning-only response may contain an unclosed
      // <think> block. Keep it in the external exchange trace, but do not feed
      // it into the terminal serialization prompt. Complete tool-call turns do
      // remain in context with their real results.
      if (!calls.length) break;
      messages.push({ role: "assistant", content: completion.message.content ?? null,
        reasoning_content: completion.message.reasoning_content ?? null, tool_calls: calls });
      for (const call of calls) {
        let result;
        try {
          if (call.function?.name === calculatorTool.function.name) result = calculate(JSON.parse(call.function.arguments));
          else if (call.function?.name === inspectTool.function.name) result = taskPayload(context, factors);
          else result = { error: "unsupported tool in auxiliary loop" };
        } catch (error) { result = { error: error.message }; }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  }
  // This llama.cpp build accepts required/auto rather than object-form named
  // tool_choice. Expose only the recorder and disable a second reasoning pass:
  // the preceding call already supplied the condition's thinking opportunity.
  const serializationFactors = { ...factors, thinking_enabled: false };
  const completion = await complete(messages, [recordTool], serializationFactors,
    "required", `${condition}_record`, ledger);
  exchanges.push(completion);
  const record = completion.message.tool_calls?.find(call => call.function?.name === recordTool.function.name);
  if (!record) throw new Error(`${condition} failed to emit recorder call`);
  return { factors, parsed: parseRecord(record), exchanges,
    calculator_calls: exchanges.flatMap(item => item.message.tool_calls ?? [])
      .filter(call => call.function?.name === calculatorTool.function.name).length };
}

function predictionPath(sourceIndex, condition) {
  return path.join(predictionDir, `context-${String(sourceIndex + 1).padStart(2, "0")}-${condition}.json`);
}
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function conditionMean(contexts, condition, endpoint) {
  return mean(contexts.map(context => context.predictions[condition].endpoints[endpoint]));
}
function pairedContrast(contexts, leftConditions, rightConditions, endpoint) {
  const differences = contexts.map(context => mean(leftConditions.map(condition =>
    context.predictions[condition].endpoints[endpoint])) - mean(rightConditions.map(condition =>
    context.predictions[condition].endpoints[endpoint])));
  return { left_mean: mean(leftConditions.map(condition => conditionMean(contexts, condition, endpoint))),
    right_mean: mean(rightConditions.map(condition => conditionMean(contexts, condition, endpoint))),
    paired_mean_difference: mean(differences), one_sided_exact_p: exactPairedPermutationPValue(differences),
    pair_differences: differences };
}
function assemble() {
  const complete = schedule.every(item => P.conditions.every(condition =>
    fs.existsSync(predictionPath(item.source_context_index, condition))));
  if (!complete) return null;
  const contexts = schedule.map(item => {
    const sourceContext = source.contexts[item.source_context_index];
    const predictions = Object.fromEntries(P.conditions.map(condition => {
      const prediction = JSON.parse(fs.readFileSync(predictionPath(item.source_context_index, condition), "utf8"));
      const rankScore = scoreCategoricalPrediction(prediction.parsed, sourceContext.outcome.delta_logits,
        sourceContext.ladder.candidates.map(candidate => candidate.baseline_logit));
      return [condition, { ...prediction, endpoints: {
        ...directionalEndpoints(sourceContext, prediction.parsed.directions_by_candidate_rank),
        delta_rank_spearman: rankScore.delta_rank_spearman,
        post_intervention_rank_spearman: rankScore.post_intervention_rank_spearman
      } }];
    }));
    return { execution_index: item.execution_index, source_context_index: item.source_context_index,
      source_captures: sourceContext.captures, candidate_strata: sourceContext.ladder.candidates.map(item => item.stratum),
      actual_directions: sourceContext.outcome.directions_by_candidate_rank, predictions };
  });
  const c = suffix => `rule${suffix[0]}_think${suffix[1]}_calc${suffix[2]}`;
  const contrasts = {
    rule_at_minimal_execution: pairedContrast(contexts, [c("100")], [c("000")], "strong_causal_accuracy"),
    thinking_with_rule: pairedContrast(contexts, [c("110"), c("111")], [c("100"), c("101")], "strong_causal_accuracy"),
    calculator_with_rule: pairedContrast(contexts, [c("101"), c("111")], [c("100"), c("110")], "strong_causal_accuracy")
  };
  let priorRejected = true;
  Object.entries(contrasts).sort((a, b) => a[1].one_sided_exact_p - b[1].one_sided_exact_p)
    .forEach(([, result], index, sorted) => {
      result.holm_threshold = 0.05 / (sorted.length - index);
      result.holm_reject = priorRejected && result.one_sided_exact_p <= result.holm_threshold;
      priorRejected = result.holm_reject;
    });
  const conditionSummaries = Object.fromEntries(P.conditions.map(condition => [condition, {
    factors: decodeCondition(condition), strong_causal_accuracy: conditionMean(contexts, condition, "strong_causal_accuracy"),
    strong_rule_fidelity: conditionMean(contexts, condition, "strong_rule_fidelity"),
    all_coordinate_causal_accuracy: conditionMean(contexts, condition, "all_coordinate_causal_accuracy"),
    near_zero_causal_accuracy: conditionMean(contexts, condition, "near_zero_causal_accuracy"),
    delta_rank_spearman: conditionMean(contexts, condition, "delta_rank_spearman"),
    calculator_uptake_rate: mean(contexts.map(context => context.predictions[condition].calculator_calls > 0 ? 1 : 0))
  }]));
  const artifact = { schema: "ik.rule-given-factorial-batch.v1", run_id: P.run_id,
    preregistration_sha256: sha256(fs.readFileSync(preregistrationPath)),
    source_artifact_sha256: sha256(sourceBuffer), completed_at: new Date().toISOString(),
    context_count: contexts.length, qwen_prediction_count: contexts.length * P.conditions.length,
    condition_summaries: conditionSummaries, confirmatory_contrasts: contrasts, contexts,
    interpretation_boundary: preregistration.interpretation_boundary };
  fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

async function integrityGate() {
  const rows = [];
  for (const item of schedule) {
    const context = source.contexts[item.source_context_index];
    const evidenceHashes = new Set();
    for (const condition of P.conditions) {
      const factors = decodeCondition(condition);
      const messages = initialMessages(context, factors);
      const payload = JSON.parse(messages.at(-1).content);
      if ("outcome" in payload || "delta_logits" in payload || "actual_directions" in payload) {
        throw new Error("outcome leakage key detected");
      }
      evidenceHashes.add(sha256(payload.evidence));
      const tools = factors.calculator_available ? [inspectTool, calculatorTool, recordTool] : [inspectTool, recordTool];
      const tokens = (await renderPromptTokenMap(baseUrl, { messages, tools,
        chat_template_kwargs: { enable_thinking: factors.thinking_enabled } })).length;
      if (tokens > 7800) throw new Error(`${condition} prompt too large: ${tokens}`);
      rows.push({ source_context_index: item.source_context_index, condition, prompt_tokens: tokens,
        evidence_sha256: sha256(payload.evidence), rule_text_present: factors.rule_given,
        calculator_offered: factors.calculator_available, thinking_enabled: factors.thinking_enabled });
    }
    if (evidenceHashes.size !== 1) throw new Error("evidence differs across factorial cells");
  }
  const result = { schema: "ik.rule-given-factorial-integrity-gate.v1", passed: true,
    source_artifact_sha256: sha256(sourceBuffer), outcome_keys_absent: true,
    identical_evidence_within_context: true, rows };
  fs.writeFileSync(path.join(outputDir, "integrity-gate.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

// A health poll cannot boot a stopped WSL guest. Explicitly start the declared
// service before the integrity gate; every prediction still restarts it again.
await restartRuntime();
const gate = await integrityGate();
if (process.argv.includes("--gate-only")) {
  console.log(JSON.stringify({ run_id: P.run_id, gate_passed: gate.passed, prompt_rows: gate.rows.length }));
  process.exit(0);
}
const maxArg = process.argv.find(value => value.startsWith("--max-predictions="));
const maxPredictions = maxArg ? Number(maxArg.split("=")[1]) : Infinity;
const ledger = new RequestLedger({ baseUrl, runId: P.run_id });
await ledger.initialize();
let completed = 0;
for (const item of schedule) {
  const context = source.contexts[item.source_context_index];
  for (const condition of item.condition_order) {
    const file = predictionPath(item.source_context_index, condition);
    if (fs.existsSync(file)) continue;
    if (completed >= maxPredictions) break;
    const prediction = await predict(context, condition, ledger);
    const sealed = { schema: "ik.rule-given-factorial-prediction.v1", source_context_index: item.source_context_index,
      condition, evidence_sha256: sha256(promptEvidence(context)), source_outcome_in_request: false,
      sealed_at: new Date().toISOString(), ...prediction };
    fs.writeFileSync(file, `${JSON.stringify(sealed, null, 2)}\n`);
    completed += 1;
    console.log(JSON.stringify({ completed_prediction: completed, source_context_index: item.source_context_index,
      condition, calculator_calls: prediction.calculator_calls }));
  }
  if (completed >= maxPredictions) break;
}
ledger.exportTo(outputDir);
const artifact = assemble();
console.log(JSON.stringify({ run_id: P.run_id, completed_this_invocation: completed,
  total_prediction_files: fs.readdirSync(predictionDir).filter(name => name.endsWith(".json")).length,
  complete: Boolean(artifact), condition_summaries: artifact?.condition_summaries ?? null,
  confirmatory_contrasts: artifact?.confirmatory_contrasts ?? null }));
