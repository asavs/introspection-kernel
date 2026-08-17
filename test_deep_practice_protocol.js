import assert from "node:assert/strict";
import {
  PROTOCOL, buildSchedule, direction, exactPairedPermutationPValue, scoreCategoricalPrediction
} from "./deep_practice_protocol.js";

const schedule = buildSchedule();
assert.equal(schedule.length, 20);
assert.deepEqual(schedule, buildSchedule(), "schedule must be deterministic");
assert.equal(new Set(schedule.map(item => item.heldout_index)).size, 20);
assert.equal(schedule.filter(item => item.condition_order[0] === "matched_practice").length, 10);
for (const position of [0, 1, 2, 3, 4]) {
  for (const episode of [0, 1, 2, 3, 4]) {
    assert.equal(schedule.filter(item => item.practice_order[position] === episode).length, 4);
  }
}
for (const item of schedule) {
  assert(item.shuffled_outcome_order.every((outcome, position) => outcome !== item.practice_order[position]));
  assert.deepEqual([...item.shuffled_outcome_order].sort(), [0, 1, 2, 3, 4]);
}
assert.equal(direction(0.051), "rise");
assert.equal(direction(-0.051), "fall");
assert.equal(direction(0.05), "stable");

const perfect = scoreCategoricalPrediction({
  directions_by_candidate_rank: ["rise", "fall", "stable", "rise", "fall"],
  predicted_delta_order_largest_to_smallest: [1, 4, 3, 5, 2],
  predicted_post_intervention_order_highest_to_lowest: [5, 4, 3, 1, 2],
  largest_rise_candidate_rank: 1,
  largest_fall_candidate_rank: 2
}, [2, -2, 0, 1, -1], [0, 3, 4, 4, 7]);
assert.equal(perfect.macro_direction_accuracy, 1);
assert.equal(perfect.largest_rise_correct, true);
assert.equal(perfect.largest_fall_correct, true);
assert.equal(perfect.delta_rank_spearman, 1);
assert.equal(perfect.post_intervention_rank_spearman, 1);
assert.equal(exactPairedPermutationPValue(Array(20).fill(1)), 1 / (2 ** 20));
assert.equal(PROTOCOL.primary_endpoints.includes("macro_direction_accuracy"), true);
console.log("deep practice protocol tests passed");
