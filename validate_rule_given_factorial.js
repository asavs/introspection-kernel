import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exactPairedPermutationPValue, scoreCategoricalPrediction } from "./sign_stratified_protocol.js";
import { RULE_FACTORIAL_PROTOCOL as P, buildRuleFactorialSchedule, decodeCondition,
  directionalEndpoints, ruleDirections } from "./rule_given_factorial_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", P.run_id);
const sourcePath = path.join(moduleDir, "runs", P.source_run_id, "artifact.json");
const preregistrationPath = path.join(moduleDir, "preregistrations", `${P.run_id}.json`);
const artifactPath = path.join(runDir, "artifact.json");
const sha256 = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest("hex");
const sourceBuffer = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBuffer);
const preregistration = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
if (sha256(sourceBuffer) !== preregistration.source.artifact_sha256) throw new Error("source hash mismatch");
if (JSON.stringify(buildRuleFactorialSchedule()) !== JSON.stringify(preregistration.randomization.schedule)) {
  throw new Error("schedule mismatch");
}

const predictionFiles = fs.readdirSync(path.join(runDir, "predictions")).filter(name => name.endsWith(".json"));
if (predictionFiles.length !== 160) throw new Error(`expected 160 prediction files, found ${predictionFiles.length}`);
const byKey = new Map(predictionFiles.map(name => {
  const value = JSON.parse(fs.readFileSync(path.join(runDir, "predictions", name), "utf8"));
  return [`${value.source_context_index}:${value.condition}`, value];
}));
if (byKey.size !== 160) throw new Error("duplicate prediction key");

const contexts = buildRuleFactorialSchedule().map(item => {
  const sourceContext = source.contexts[item.source_context_index];
  const predictions = Object.fromEntries(P.conditions.map(condition => {
    const raw = byKey.get(`${item.source_context_index}:${condition}`);
    if (!raw) throw new Error(`missing ${item.source_context_index}:${condition}`);
    if (raw.source_outcome_in_request !== false) throw new Error("outcome request flag changed");
    if (JSON.stringify(raw.factors) !== JSON.stringify(decodeCondition(condition))) throw new Error("factor mismatch");
    const rank = scoreCategoricalPrediction(raw.parsed, sourceContext.outcome.delta_logits,
      sourceContext.ladder.candidates.map(candidate => candidate.baseline_logit));
    const endpoints = { ...directionalEndpoints(sourceContext, raw.parsed.directions_by_candidate_rank),
      delta_rank_spearman: rank.delta_rank_spearman,
      post_intervention_rank_spearman: rank.post_intervention_rank_spearman };
    return [condition, { raw, endpoints }];
  }));
  if (new Set(Object.values(predictions).map(item => item.raw.evidence_sha256)).size !== 1) {
    throw new Error(`evidence mismatch within context ${item.source_context_index}`);
  }
  return { source_context_index: item.source_context_index, sourceContext, predictions };
});

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const conditionMean = (condition, endpoint) => mean(contexts.map(context =>
  context.predictions[condition].endpoints[endpoint]));
const contrast = (left, right, endpoint = "strong_causal_accuracy") => {
  const differences = contexts.map(context => mean(left.map(condition => context.predictions[condition].endpoints[endpoint]))
    - mean(right.map(condition => context.predictions[condition].endpoints[endpoint])));
  return { left_mean: mean(left.map(condition => conditionMean(condition, endpoint))),
    right_mean: mean(right.map(condition => conditionMean(condition, endpoint))),
    paired_mean_difference: mean(differences), one_sided_exact_p: exactPairedPermutationPValue(differences),
    pair_differences: differences };
};
const c = suffix => `rule${suffix[0]}_think${suffix[1]}_calc${suffix[2]}`;
const confirmatory = {
  rule_at_minimal_execution: contrast([c("100")], [c("000")]),
  thinking_with_rule: contrast([c("110"), c("111")], [c("100"), c("101")]),
  calculator_with_rule: contrast([c("101"), c("111")], [c("100"), c("110")])
};
let priorRejected = true;
Object.values(confirmatory).sort((a, b) => a.one_sided_exact_p - b.one_sided_exact_p)
  .forEach((result, index, sorted) => {
    result.holm_threshold = 0.05 / (sorted.length - index);
    result.holm_reject = priorRejected && result.one_sided_exact_p <= result.holm_threshold;
    priorRejected = result.holm_reject;
  });

const condition_summaries = Object.fromEntries(P.conditions.map(condition => [condition, {
  factors: decodeCondition(condition),
  strong_causal_accuracy: conditionMean(condition, "strong_causal_accuracy"),
  strong_rule_fidelity: conditionMean(condition, "strong_rule_fidelity"),
  all_coordinate_causal_accuracy: conditionMean(condition, "all_coordinate_causal_accuracy"),
  near_zero_causal_accuracy: conditionMean(condition, "near_zero_causal_accuracy"),
  delta_rank_spearman: conditionMean(condition, "delta_rank_spearman"),
  calculator_uptake_rate: mean(contexts.map(context => context.predictions[condition].raw.calculator_calls > 0 ? 1 : 0)),
  recorder_correction_rate: mean(contexts.map(context => (context.predictions[condition].raw.recorder_correction_count ?? 0) > 0 ? 1 : 0)),
  mean_exchange_count: mean(contexts.map(context => context.predictions[condition].raw.exchanges.length)),
  length_termination_rate: mean(contexts.map(context => context.predictions[condition].raw.exchanges
    .some(exchange => exchange.finish_reason === "length") ? 1 : 0))
}]));

for (const condition of P.conditions) {
  for (const endpoint of ["strong_causal_accuracy", "strong_rule_fidelity", "all_coordinate_causal_accuracy",
    "near_zero_causal_accuracy", "delta_rank_spearman", "calculator_uptake_rate"]) {
    if (Math.abs(condition_summaries[condition][endpoint] - artifact.condition_summaries[condition][endpoint]) > 1e-12) {
      throw new Error(`artifact mismatch: ${condition} ${endpoint}`);
    }
  }
}
for (const name of Object.keys(confirmatory)) {
  for (const key of ["left_mean", "right_mean", "paired_mean_difference", "one_sided_exact_p", "holm_threshold"]) {
    if (Math.abs(confirmatory[name][key] - artifact.confirmatory_contrasts[name][key]) > 1e-12) {
      throw new Error(`contrast mismatch: ${name} ${key}`);
    }
  }
  if (confirmatory[name].holm_reject !== artifact.confirmatory_contrasts[name].holm_reject) {
    throw new Error(`Holm mismatch: ${name}`);
  }
}

const benchmark = mean(contexts.map(context => {
  const actual = context.sourceContext.outcome.directions_by_candidate_rank;
  const prescribed = ruleDirections(context.sourceContext);
  const strong = context.sourceContext.ladder.candidates.map((candidate, index) => ({ candidate, index }))
    .filter(item => item.candidate.stratum !== "near_zero");
  return strong.filter(item => prescribed[item.index] === actual[item.index]).length / strong.length;
}));
const ruleGiven = P.conditions.filter(condition => decodeCondition(condition).rule_given);
const ruleWithheld = P.conditions.filter(condition => !decodeCondition(condition).rule_given);
const result = {
  schema: "ik.rule-given-factorial-validation.v1", valid: true,
  source_artifact_sha256: sha256(sourceBuffer), prediction_file_count: predictionFiles.length,
  condition_summaries, confirmatory_contrasts: confirmatory,
  deterministic_negative_jvp_strong_causal_accuracy: benchmark,
  descriptive_contrasts: {
    rule_main_effect: contrast(ruleGiven, ruleWithheld),
    rule_main_effect_on_fidelity: contrast(ruleGiven, ruleWithheld, "strong_rule_fidelity")
  },
  preregistered_decisions: {
    inference_failure_supported: ruleGiven.some(condition => condition_summaries[condition].strong_rule_fidelity >= 0.9
      && condition_summaries[condition].strong_causal_accuracy >= 0.7)
      && ruleGiven.some(condition => {
        const factors = decodeCondition(condition);
        const matched = `rule0_think${factors.thinking_enabled ? 1 : 0}_calc${factors.calculator_available ? 1 : 0}`;
        return condition_summaries[matched].strong_rule_fidelity < 0.9;
      }),
    execution_failure_supported: ruleGiven.every(condition => condition_summaries[condition].strong_rule_fidelity < 0.9),
    spontaneous_discovery_supported: ruleWithheld.some(condition => condition_summaries[condition].strong_rule_fidelity >= 0.9),
    calculator_manipulation_taken_up: ruleGiven.some(condition => condition_summaries[condition].calculator_uptake_rate > 0)
  }
};
fs.writeFileSync(path.join(runDir, "validation.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));

