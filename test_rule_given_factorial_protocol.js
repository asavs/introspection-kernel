import assert from "node:assert/strict";
import { RULE_FACTORIAL_PROTOCOL as P, buildRuleFactorialSchedule, decodeCondition,
  directionalEndpoints } from "./rule_given_factorial_protocol.js";

const schedule = buildRuleFactorialSchedule();
assert.equal(schedule.length, 20);
assert.equal(new Set(schedule.map(item => item.source_context_index)).size, 20);
for (const item of schedule) assert.deepEqual([...item.condition_order].sort(), [...P.conditions].sort());
for (const condition of P.conditions) {
  const positions = schedule.map(item => item.condition_order.indexOf(condition));
  for (let position = 0; position < 8; position += 1) {
    assert.ok([2, 3].includes(positions.filter(value => value === position).length));
  }
  assert.equal(typeof decodeCondition(condition).rule_given, "boolean");
}
const context = {
  ladder: { candidates: [
    { rank: 1, stratum: "positive_1", local_logit_derivative: 2 },
    { rank: 2, stratum: "negative_1", local_logit_derivative: -2 },
    { rank: 3, stratum: "positive_2", local_logit_derivative: 1 },
    { rank: 4, stratum: "negative_2", local_logit_derivative: -1 },
    { rank: 5, stratum: "near_zero", local_logit_derivative: 0 }
  ] },
  outcome: { directions_by_candidate_rank: ["fall", "rise", "fall", "rise", "rise"] }
};
const endpoint = directionalEndpoints(context, ["fall", "rise", "fall", "rise", "stable"]);
assert.equal(endpoint.strong_causal_accuracy, 1);
assert.equal(endpoint.strong_rule_fidelity, 1);
assert.equal(endpoint.near_zero_causal_accuracy, 0);
assert.equal(endpoint.near_zero_rule_fidelity, 1);
console.log("rule-given factorial protocol tests passed");

