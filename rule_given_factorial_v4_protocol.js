import { seededRandom, shuffle } from "./deep_practice_protocol.js";
import { decodeCondition, directionalEndpoints, ruleDirections, strongCandidateRanks }
  from "./rule_given_factorial_protocol.js";

export const RULE_FACTORIAL_V4 = Object.freeze({
  schema: "ik.rule-given-factorial-preregistration.v4",
  run_id: "rule-given-execution-v4-preregistered-20260817-001",
  aborted_predecessor_run_id: "rule-given-execution-v3-preregistered-20260817-001",
  source_run_id: "sign-stratified-practice-preregistered-20260816-002",
  randomization_seed: "ik-rule-given-execution-v4-20260817",
  context_count: 20,
  direction_epsilon: 0.05,
  calculator_max_tokens: 512,
  thinking_max_tokens: 2048,
  recorder_max_tokens: 256,
  conditions: Object.freeze([
    "rule0_think0_calc0", "rule0_think0_calc1", "rule0_think1_calc0", "rule0_think1_calc1",
    "rule1_think0_calc0", "rule1_think0_calc1", "rule1_think1_calc0", "rule1_think1_calc1"
  ])
});

export function buildRuleFactorialV4Schedule(protocol = RULE_FACTORIAL_V4) {
  const base = shuffle(protocol.conditions, seededRandom(`${protocol.randomization_seed}:base`));
  const contexts = shuffle([...Array(protocol.context_count).keys()],
    seededRandom(`${protocol.randomization_seed}:contexts`));
  return contexts.map((source_context_index, execution_index) => {
    const rotation = execution_index % base.length;
    let condition_order = [...base.slice(rotation), ...base.slice(0, rotation)];
    if (Math.floor(execution_index / base.length) % 2) condition_order = condition_order.toReversed();
    return { execution_index, source_context_index, condition_order };
  });
}

export { decodeCondition, directionalEndpoints, ruleDirections, strongCandidateRanks };


