import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROTOCOL, buildSchedule, direction, exactPairedPermutationPValue, scoreCategoricalPrediction
} from "./deep_practice_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", PROTOCOL.run_id);
const artifact = JSON.parse(fs.readFileSync(path.join(runDir, "artifact.json"), "utf8"));
const practice = JSON.parse(fs.readFileSync(path.join(runDir, "practice.json"), "utf8"));
const preregistration = JSON.parse(fs.readFileSync(
  path.join(moduleDir, "preregistrations", `${PROTOCOL.run_id}.json`), "utf8"));
const pairFiles = fs.readdirSync(runDir).filter(name => /^pair-\d\d\.json$/.test(name)).sort();
const pairs = pairFiles.map(name => JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8")));

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function close(actual, expected, epsilon = 1e-12) { assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`); }
function widths(ladder) {
  return [ladder.full.head_activation.width, ladder.full.projected_head_contribution.width,
    ladder.full.final_mlp_residual_delta.width, ladder.full.final_normalized_residual_delta.width,
    ladder.full.local_logit_jvp.width];
}

assert.equal(pairFiles.length, 20);
assert.equal(artifact.pair_count, 20);
assert.equal(practice.length, 5);
assert.deepEqual(preregistration.randomization.schedule, buildSchedule());
assert.deepEqual([...pairs.map(pair => pair.schedule.heldout_index)].sort((a, b) => a - b), [...Array(20).keys()]);
assert.equal(pairs.filter(pair => pair.schedule.condition_order[0] === "matched_practice").length, 10);
for (const episode of practice) assert.deepEqual(widths(episode.ladder), [128, 4096, 4096, 4096, 151936]);

const predictionCounts = { matched_practice: 0, outcome_shuffled_practice: 0 };
const predictionDirections = { matched_practice: { rise: 0, fall: 0, stable: 0 },
  outcome_shuffled_practice: { rise: 0, fall: 0, stable: 0 } };
const actualDirections = { rise: 0, fall: 0, stable: 0 };
let identicalDirectionVectors = 0;
let identicalCompletePredictions = 0;
let jvpLinearCorrect = 0;
let allRiseCorrect = 0;
let candidateCount = 0;
const promptCounts = [];

for (const pair of pairs) {
  assert.deepEqual(widths(pair.ladder), [128, 4096, 4096, 4096, 151936]);
  assert.equal(pair.prediction_outcome_order_check, true);
  assert.equal(pair.schedule.shuffled_outcome_order.every((value, index) =>
    value !== pair.schedule.practice_order[index]), true);
  const counts = Object.values(pair.prompt_token_counts);
  assert.equal(new Set(counts).size, 1);
  assert(counts[0] <= 7800);
  promptCounts.push(...counts);
  assert.deepEqual([...pair.predictions.map(item => item.condition)].sort(), [...PROTOCOL.conditions].sort());
  const matched = pair.predictions.find(item => item.condition === "matched_practice").prediction.parsed;
  const shuffled = pair.predictions.find(item => item.condition === "outcome_shuffled_practice").prediction.parsed;
  if (JSON.stringify(matched.directions_by_candidate_rank) === JSON.stringify(shuffled.directions_by_candidate_rank)) {
    identicalDirectionVectors += 1;
  }
  if (JSON.stringify(matched) === JSON.stringify(shuffled)) identicalCompletePredictions += 1;
  const baselineLogits = pair.ladder.candidates.map(item => item.baseline_logit);
  for (const record of pair.predictions) {
    predictionCounts[record.condition] += 1;
    assert.equal(record.prediction.sha256, sha256(record.prediction.parsed));
    for (const value of record.prediction.parsed.directions_by_candidate_rank) predictionDirections[record.condition][value] += 1;
    const expected = scoreCategoricalPrediction(record.prediction.parsed, pair.outcome.delta_logits, baselineLogits);
    const observed = pair.scored.find(item => item.condition === record.condition).score;
    assert.deepEqual(observed, expected);
  }
  pair.outcome.directions_by_candidate_rank.forEach((actual, index) => {
    actualDirections[actual] += 1;
    candidateCount += 1;
    if (actual === "rise") allRiseCorrect += 1;
    const derivative = pair.ladder.model_facing.local_logit_jvp.candidate_panel[index].local_logit_derivative;
    if (direction(-derivative) === actual) jvpLinearCorrect += 1;
  });
}
assert.deepEqual(predictionCounts, { matched_practice: 20, outcome_shuffled_practice: 20 });

const recomputedEndpoints = {};
for (const endpoint of PROTOCOL.primary_endpoints) {
  const matched = pairs.map(pair => pair.scored.find(item => item.condition === "matched_practice").score[endpoint]);
  const shuffled = pairs.map(pair => pair.scored.find(item => item.condition === "outcome_shuffled_practice").score[endpoint]);
  const differences = matched.map((value, index) => value - shuffled[index]);
  recomputedEndpoints[endpoint] = { matched_mean: mean(matched), shuffled_mean: mean(shuffled),
    paired_mean_difference: mean(differences), one_sided_exact_p: exactPairedPermutationPValue(differences),
    pair_differences: differences };
  const recorded = artifact.endpoint_results[endpoint];
  close(recorded.matched_mean, recomputedEndpoints[endpoint].matched_mean);
  close(recorded.shuffled_mean, recomputedEndpoints[endpoint].shuffled_mean);
  close(recorded.paired_mean_difference, recomputedEndpoints[endpoint].paired_mean_difference);
  close(recorded.one_sided_exact_p, recomputedEndpoints[endpoint].one_sided_exact_p);
  assert.deepEqual(recorded.pair_differences, differences);
}

const validation = {
  schema: "ik.deep-practice-validation.v1",
  run_id: PROTOCOL.run_id,
  valid: true,
  controls: {
    heldout_pairs: pairs.length,
    predictions_by_condition: predictionCounts,
    matched_first_pairs: 10,
    shuffled_first_pairs: 10,
    all_shuffled_mappings_are_derangements: true,
    prompt_token_counts_equal_within_every_pair: true,
    prompt_token_range: [Math.min(...promptCounts), Math.max(...promptCounts)],
    evidence_widths: [128, 4096, 4096, 4096, 151936],
    scores_recomputed_exactly: true
  },
  confirmatory_endpoints: recomputedEndpoints,
  diagnostic_baselines: {
    actual_direction_counts: actualDirections,
    predicted_direction_counts: predictionDirections,
    all_rise_direction_accuracy: allRiseCorrect / candidateCount,
    local_linear_negative_jvp_direction_accuracy: jvpLinearCorrect / candidateCount,
    identical_matched_shuffled_direction_vectors: identicalDirectionVectors,
    identical_complete_matched_shuffled_predictions: identicalCompletePredictions
  },
  diagnosis: [
    "Matched practice did not significantly outperform outcome-shuffled practice on either preregistered primary endpoint.",
    "Matched direction accuracy equals the all-rise base-rate baseline because every matched prediction was rise.",
    "The local linear negative-JVP heuristic substantially outperforms Qwen, showing that the internal channel contains usable directional information.",
    "Top-absolute-JVP candidate selection yielded an imbalanced outcome set and should be replaced by sign-stratified, pre-outcome selection."
  ]
};
fs.writeFileSync(path.join(runDir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
