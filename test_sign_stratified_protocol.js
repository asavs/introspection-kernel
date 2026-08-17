import assert from "node:assert/strict";
import {
  SIGN_PROTOCOL, buildSignSchedule, canonicalSignPanel, heuristicPredictions, permutePanel
} from "./sign_stratified_protocol.js";

const schedule = buildSignSchedule();
assert.equal(schedule.length, 20);
assert.deepEqual(schedule, buildSignSchedule());
assert.equal(new Set(schedule.map(item => item.heldout_index)).size, 20);
for (const condition of SIGN_PROTOCOL.model_conditions) {
  const positions = [0, 1, 2].map(position =>
    schedule.filter(item => item.condition_order[position] === condition).length);
  assert(Math.max(...positions) - Math.min(...positions) <= 1);
}
for (const position of [0, 1, 2, 3, 4]) {
  for (const episode of [0, 1, 2, 3, 4]) {
    assert.equal(schedule.filter(item => item.practice_order[position] === episode).length, 4);
  }
}
for (const item of schedule) {
  assert(item.shuffled_outcome_order.every((value, position) => value !== item.practice_order[position]));
  assert.deepEqual([...item.heldout_panel_permutation].sort(), [0, 1, 2, 3, 4]);
}

const jvp = {
  top_positive_coordinates: [{ coordinate: 10, derivative: 3 }, { coordinate: 11, derivative: 2 }],
  top_negative_coordinates: [{ coordinate: 20, derivative: -4 }, { coordinate: 21, derivative: -2 }],
  closest_to_zero_coordinates: [{ coordinate: 30, derivative: 0 }]
};
const panel = permutePanel(canonicalSignPanel(jvp), [2, 0, 4, 3, 1]).map(item => ({
  ...item, token_id: item.coordinate, local_logit_derivative: item.derivative, baseline_logit: 0
}));
assert.deepEqual(panel.map(item => item.stratum), ["negative_1", "positive_1", "near_zero", "negative_2", "positive_2"]);
assert.deepEqual(heuristicPredictions(panel).negative_jvp_sign.directions_by_candidate_rank,
  ["rise", "fall", "stable", "rise", "fall"]);
console.log("sign-stratified protocol tests passed");

