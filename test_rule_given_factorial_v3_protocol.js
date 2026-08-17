import assert from "node:assert/strict";
import { RULE_FACTORIAL_V3 as P, buildRuleFactorialV3Schedule, decodeCondition }
  from "./rule_given_factorial_v3_protocol.js";

const schedule = buildRuleFactorialV3Schedule();
assert.equal(schedule.length, 20);
assert.equal(new Set(schedule.map(item => item.source_context_index)).size, 20);
for (const item of schedule) assert.deepEqual([...item.condition_order].sort(), [...P.conditions].sort());
for (const condition of P.conditions) {
  const positions = schedule.map(item => item.condition_order.indexOf(condition));
  for (let position = 0; position < 8; position += 1) {
    assert.ok([2, 3].includes(positions.filter(value => value === position).length));
  }
  assert.equal(typeof decodeCondition(condition).thinking_enabled, "boolean");
}
console.log("rule-given factorial V3 protocol tests passed");

