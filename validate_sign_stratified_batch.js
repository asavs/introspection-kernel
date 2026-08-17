import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGN_PROTOCOL_V2 as PROTOCOL, buildSignScheduleV2 } from "./sign_stratified_protocol_v2.js";
import { heuristicPredictions, scoreCategoricalPrediction, exactPairedPermutationPValue } from "./sign_stratified_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", PROTOCOL.run_id);
const artifact = JSON.parse(fs.readFileSync(path.join(runDir, "artifact.json"), "utf8"));
const practice = JSON.parse(fs.readFileSync(path.join(runDir, "practice.json"), "utf8"));
const preregistration = JSON.parse(fs.readFileSync(path.join(moduleDir, "preregistrations", `${PROTOCOL.run_id}.json`), "utf8"));
const contextFiles = fs.readdirSync(runDir).filter(name => /^context-\d\d\.json$/.test(name)).sort();
const contexts = contextFiles.map(name => JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8")));

function sha256(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function close(a, b) { assert(Math.abs(a - b) <= 1e-12, `${a} != ${b}`); }
function widths(ladder) { return [ladder.full.head_activation.width, ladder.full.projected_head_contribution.width,
  ladder.full.final_mlp_residual_delta.width, ladder.full.final_normalized_residual_delta.width,
  ladder.full.local_logit_jvp.width]; }
function values(condition, collection, endpoint) {
  return contexts.map(context => context[collection].find(item => item.condition === condition).score[endpoint]);
}
function contrast(left, right, endpoint = PROTOCOL.primary_endpoint) {
  const a = values(left, "scored_models", endpoint);
  const collection = PROTOCOL.model_conditions.includes(right) ? "scored_models" : "scored_heuristics";
  const b = values(right, collection, endpoint);
  const differences = a.map((value, index) => value - b[index]);
  return { left_mean: mean(a), right_mean: mean(b), paired_mean_difference: mean(differences),
    one_sided_exact_p: exactPairedPermutationPValue(differences), pair_differences: differences };
}

assert.equal(contexts.length, 20);
assert.equal(artifact.context_count, 20);
assert.deepEqual(preregistration.randomization.schedule, buildSignScheduleV2());
assert.equal(practice.diversity_gate.passed, true);
assert((practice.diversity_gate.direction_counts.rise ?? 0) >= 5);
assert((practice.diversity_gate.direction_counts.fall ?? 0) >= 5);
assert(practice.diversity_gate.distinct_outcome_vectors >= 3);
assert.deepEqual([...contexts.map(item => item.schedule.heldout_index)].sort((a, b) => a - b), [...Array(20).keys()]);

const actualCounts = { rise: 0, fall: 0, stable: 0 };
const predictedCounts = Object.fromEntries(PROTOCOL.model_conditions.map(condition => [condition, { rise: 0, fall: 0, stable: 0 }]));
const stratumDiagnostics = {};
const heuristicClassCounts = { rise: 0, fall: 0, stable: 0 };
const modelAgreementWithNegativeJvp = Object.fromEntries(PROTOCOL.model_conditions.map(condition => [condition, 0]));
let candidateCount = 0;
let matchedShuffledIdentical = 0;
let matchedNoPracticeIdentical = 0;
const promptCounts = [];

for (const context of contexts) {
  assert.deepEqual(widths(context.ladder), [128, 4096, 4096, 4096, 151936]);
  assert.equal(context.all_predictions_sealed_before_outcome, true);
  assert.equal(context.prompt_token_counts.matched_practice, context.prompt_token_counts.outcome_shuffled_practice);
  assert(Math.max(...Object.values(context.prompt_token_counts)) <= 7800);
  promptCounts.push(...Object.values(context.prompt_token_counts));
  assert.deepEqual([...context.predictions.map(item => item.condition)].sort(), [...PROTOCOL.model_conditions].sort());
  const strata = context.ladder.candidates.map(item => item.stratum);
  assert.equal(strata.filter(value => value.startsWith("positive_")).length, 2);
  assert.equal(strata.filter(value => value.startsWith("negative_")).length, 2);
  assert.equal(strata.filter(value => value === "near_zero").length, 1);
  const baseline = context.ladder.candidates.map(item => item.baseline_logit);
  for (const record of context.predictions) {
    assert.equal(record.prediction.sha256, sha256(record.prediction.parsed));
    const score = scoreCategoricalPrediction(record.prediction.parsed, context.outcome.delta_logits, baseline);
    assert.deepEqual(score, context.scored_models.find(item => item.condition === record.condition).score);
    record.prediction.parsed.directions_by_candidate_rank.forEach(value => { predictedCounts[record.condition][value] += 1; });
  }
  const heuristics = heuristicPredictions(context.ladder.candidates);
  for (const [condition, prediction] of Object.entries(heuristics)) {
    const score = scoreCategoricalPrediction(prediction, context.outcome.delta_logits, baseline);
    const recorded = context.scored_heuristics.find(item => item.condition === condition);
    assert.deepEqual(prediction, recorded.prediction);
    assert.deepEqual(score, recorded.score);
  }
  const parsed = Object.fromEntries(context.predictions.map(item => [item.condition, item.prediction.parsed]));
  if (JSON.stringify(parsed.matched_practice.directions_by_candidate_rank)
      === JSON.stringify(parsed.outcome_shuffled_practice.directions_by_candidate_rank)) matchedShuffledIdentical += 1;
  if (JSON.stringify(parsed.matched_practice.directions_by_candidate_rank)
      === JSON.stringify(parsed.no_practice.directions_by_candidate_rank)) matchedNoPracticeIdentical += 1;
  context.ladder.candidates.forEach((candidate, index) => {
    const actual = context.outcome.directions_by_candidate_rank[index];
    const jvpPrediction = heuristics.negative_jvp_sign.directions_by_candidate_rank[index];
    actualCounts[actual] += 1;
    heuristicClassCounts[jvpPrediction] += 1;
    candidateCount += 1;
    const diag = stratumDiagnostics[candidate.stratum] ?? { count: 0,
      actual_counts: { rise: 0, fall: 0, stable: 0 }, negative_jvp_correct: 0,
      model_correct: Object.fromEntries(PROTOCOL.model_conditions.map(condition => [condition, 0])) };
    diag.count += 1; diag.actual_counts[actual] += 1;
    if (jvpPrediction === actual) diag.negative_jvp_correct += 1;
    stratumDiagnostics[candidate.stratum] = diag;
    for (const condition of PROTOCOL.model_conditions) {
      if (parsed[condition].directions_by_candidate_rank[index] === actual) diag.model_correct[condition] += 1;
      if (parsed[condition].directions_by_candidate_rank[index] === jvpPrediction) {
        modelAgreementWithNegativeJvp[condition] += 1;
      }
    }
  });
}
assert.deepEqual(heuristicClassCounts, { rise: 40, fall: 40, stable: 20 });
for (const diag of Object.values(stratumDiagnostics)) {
  diag.negative_jvp_accuracy = diag.negative_jvp_correct / diag.count;
  diag.model_accuracy = Object.fromEntries(Object.entries(diag.model_correct)
    .map(([condition, correct]) => [condition, correct / diag.count]));
}
for (const condition of PROTOCOL.model_conditions) modelAgreementWithNegativeJvp[condition] /= candidateCount;

const primary = { matched_vs_shuffled: contrast("matched_practice", "outcome_shuffled_practice"),
  matched_vs_no_practice: contrast("matched_practice", "no_practice") };
const sorted = Object.entries(primary).sort((a, b) => a[1].one_sided_exact_p - b[1].one_sided_exact_p);
let priorRejected = true;
for (let index = 0; index < sorted.length; index += 1) {
  const result = sorted[index][1];
  result.holm_threshold = 0.05 / (sorted.length - index);
  result.holm_reject = priorRejected && result.one_sided_exact_p <= result.holm_threshold;
  priorRejected = result.holm_reject;
}
assert.deepEqual(primary, artifact.primary_contrasts);
const benchmarks = { matched_vs_all_rise: contrast("matched_practice", "all_rise"),
  matched_vs_negative_jvp_sign: contrast("matched_practice", "negative_jvp_sign") };
assert.deepEqual(benchmarks, artifact.benchmarks);
const secondary = { matched_vs_shuffled: contrast("matched_practice", "outcome_shuffled_practice", "delta_rank_spearman"),
  matched_vs_no_practice: contrast("matched_practice", "no_practice", "delta_rank_spearman") };
assert.deepEqual(secondary, artifact.secondary_rank);

const validation = { schema: "ik.sign-stratified-validation.v1", run_id: PROTOCOL.run_id, valid: true,
  controls: { heldout_contexts: 20, qwen_predictions: 60, prompt_token_range: [Math.min(...promptCounts), Math.max(...promptCounts)],
    matched_shuffled_prompt_parity: true, evidence_widths: [128, 4096, 4096, 4096, 151936],
    selected_practice_direction_counts: practice.diversity_gate.direction_counts,
    selected_practice_distinct_vectors: practice.diversity_gate.distinct_outcome_vectors,
    heuristic_pre_outcome_class_counts: heuristicClassCounts, scores_recomputed_exactly: true },
  primary_contrasts: primary, benchmarks, secondary_rank: secondary,
  diagnostics: { actual_direction_counts: actualCounts, predicted_direction_counts: predictedCounts,
    model_agreement_with_negative_jvp: modelAgreementWithNegativeJvp,
    matched_shuffled_identical_direction_vectors: matchedShuffledIdentical,
    matched_no_practice_identical_direction_vectors: matchedNoPracticeIdentical,
    by_stratum: stratumDiagnostics },
  diagnosis: [
    "Matched practice did not significantly outperform shuffled or absent practice.",
    "Matched Qwen underperformed both the all-rise baseline and the negative-JVP causal heuristic.",
    "Qwen predictions varied across conditions, but agreement with the negative-JVP rule remained near chance.",
    "The internal channel was directionally informative while this in-context curriculum failed to teach Qwen to read it."
  ] };
fs.writeFileSync(path.join(runDir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
