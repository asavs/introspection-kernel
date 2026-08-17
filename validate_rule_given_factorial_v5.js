import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exactPairedPermutationPValue } from "./sign_stratified_protocol.js";
import { RULE_FACTORIAL_V5 as P, buildRuleFactorialV5Schedule, decodeCondition,
  directionalEndpoints, ruleDirections } from "./rule_given_factorial_v5_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", P.run_id);
const sourcePath = path.join(moduleDir, "runs", P.source_run_id, "artifact.json");
const preregPath = path.join(moduleDir, "preregistrations", `${P.run_id}.json`);
const sha256 = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest("hex");
const sourceBuffer = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBuffer);
const prereg = JSON.parse(fs.readFileSync(preregPath, "utf8"));
const artifact = JSON.parse(fs.readFileSync(path.join(runDir, "artifact.json"), "utf8"));
const schedule = buildRuleFactorialV5Schedule();
if (sha256(sourceBuffer) !== prereg.source.artifact_sha256) throw new Error("source hash mismatch");
if (JSON.stringify(schedule) !== JSON.stringify(prereg.randomization.schedule)) throw new Error("schedule mismatch");

const names = fs.readdirSync(path.join(runDir, "predictions")).filter(name => name.endsWith(".json"));
if (names.length !== 160) throw new Error(`expected 160 predictions, found ${names.length}`);
const byKey = new Map(names.map(name => {
  const raw = JSON.parse(fs.readFileSync(path.join(runDir, "predictions", name), "utf8"));
  return [`${raw.source_context_index}:${raw.condition}`, raw];
}));
if (byKey.size !== 160) throw new Error("duplicate prediction key");

const contexts = schedule.map(item => {
  const sourceContext = source.contexts[item.source_context_index];
  const predictions = Object.fromEntries(P.conditions.map(condition => {
    const raw = byKey.get(`${item.source_context_index}:${condition}`);
    if (!raw) throw new Error(`missing ${item.source_context_index}:${condition}`);
    if (raw.source_outcome_in_request !== false) throw new Error("outcome request flag changed");
    if (JSON.stringify(raw.factors) !== JSON.stringify(decodeCondition(condition))) throw new Error("factor mismatch");
    const labels = raw.parsed?.directions_by_candidate_rank;
    const endpoints = labels ? directionalEndpoints(sourceContext, labels) : {
      strong_causal_accuracy: 0, strong_rule_fidelity: 0, all_coordinate_causal_accuracy: 0,
      near_zero_causal_accuracy: 0, near_zero_rule_fidelity: 0
    };
    return [condition, { raw, endpoints }];
  }));
  if (new Set(Object.values(predictions).map(value => value.raw.evidence_sha256)).size !== 1) {
    throw new Error(`evidence mismatch in context ${item.source_context_index}`);
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
    result.holm_threshold = .05 / (sorted.length - index);
    result.holm_reject = priorRejected && result.one_sided_exact_p <= result.holm_threshold;
    priorRejected = result.holm_reject;
  });

const condition_summaries = Object.fromEntries(P.conditions.map(condition => [condition, {
  factors: decodeCondition(condition),
  strong_causal_accuracy: conditionMean(condition, "strong_causal_accuracy"),
  strong_rule_fidelity: conditionMean(condition, "strong_rule_fidelity"),
  all_coordinate_causal_accuracy: conditionMean(condition, "all_coordinate_causal_accuracy"),
  near_zero_causal_accuracy: conditionMean(condition, "near_zero_causal_accuracy"),
  valid_prediction_rate: mean(contexts.map(context => context.predictions[condition].raw.parsed ? 1 : 0)),
  calculator_valid_rate: decodeCondition(condition).calculator_available
    ? mean(contexts.map(context => context.predictions[condition].raw.calculator?.valid ? 1 : 0)) : null,
  thinking_length_rate: decodeCondition(condition).thinking_enabled
    ? mean(contexts.map(context => context.predictions[condition].raw.transcript?.finish_reason === "length" ? 1 : 0)) : null
}]));
const close = (left, right) => Math.abs(left - right) <= 1e-12;
for (const condition of P.conditions) {
  for (const key of ["strong_causal_accuracy", "strong_rule_fidelity", "all_coordinate_causal_accuracy",
    "near_zero_causal_accuracy", "valid_prediction_rate"]) {
    if (!close(condition_summaries[condition][key], artifact.condition_summaries[condition][key])) {
      throw new Error(`artifact mismatch ${condition} ${key}`);
    }
  }
}
for (const name of Object.keys(confirmatory)) {
  for (const key of ["left_mean", "right_mean", "paired_mean_difference", "one_sided_exact_p", "holm_threshold"]) {
    if (!close(confirmatory[name][key], artifact.confirmatory_contrasts[name][key])) throw new Error(`contrast mismatch ${name} ${key}`);
  }
  if (confirmatory[name].holm_reject !== artifact.confirmatory_contrasts[name].holm_reject) throw new Error(`Holm mismatch ${name}`);
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
const result = { schema: "ik.rule-given-factorial-v5-validation.v1", valid: true,
  source_artifact_sha256: sha256(sourceBuffer), prediction_file_count: names.length,
  condition_summaries, confirmatory_contrasts: confirmatory,
  deterministic_negative_jvp_strong_causal_accuracy: benchmark,
  preregistered_decisions: {
    clean_execution_success: ruleGiven.some(condition => condition_summaries[condition].strong_rule_fidelity >= .9
      && condition_summaries[condition].strong_causal_accuracy >= .7),
    persistent_execution_failure: ruleGiven.every(condition => condition_summaries[condition].strong_rule_fidelity < .9),
    spontaneous_discovery: ruleWithheld.some(condition => condition_summaries[condition].strong_rule_fidelity >= .9),
    calculator_rescue: condition_summaries[c("101")].strong_causal_accuracy > condition_summaries[c("100")].strong_causal_accuracy
      || condition_summaries[c("111")].strong_causal_accuracy > condition_summaries[c("110")].strong_causal_accuracy
  } };
fs.writeFileSync(path.join(runDir, "validation.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ valid: result.valid, benchmark, decisions: result.preregistered_decisions,
  confirmatory: result.confirmatory_contrasts }));
