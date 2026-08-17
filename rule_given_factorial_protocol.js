import { seededRandom, shuffle } from "./deep_practice_protocol.js";

export const RULE_FACTORIAL_PROTOCOL = Object.freeze({
  schema: "ik.rule-given-factorial-preregistration.v1",
  run_id: "rule-given-factorial-preregistered-20260816-001",
  randomization_seed: "ik-rule-given-factorial-v1-20260816",
  source_run_id: "sign-stratified-practice-preregistered-20260816-002",
  context_count: 20,
  direction_epsilon: 0.05,
  max_auxiliary_tool_rounds: 3,
  conditions: Object.freeze([
    "rule0_think0_calc0", "rule0_think0_calc1", "rule0_think1_calc0", "rule0_think1_calc1",
    "rule1_think0_calc0", "rule1_think0_calc1", "rule1_think1_calc0", "rule1_think1_calc1"
  ])
});

export function decodeCondition(id) {
  const match = /^rule([01])_think([01])_calc([01])$/.exec(id);
  if (!match) throw new Error(`invalid factorial condition: ${id}`);
  return { rule_given: match[1] === "1", thinking_enabled: match[2] === "1",
    calculator_available: match[3] === "1" };
}

export function buildRuleFactorialSchedule(protocol = RULE_FACTORIAL_PROTOCOL) {
  const base = shuffle(protocol.conditions, seededRandom(`${protocol.randomization_seed}:base`));
  const contextOrder = shuffle([...Array(protocol.context_count).keys()],
    seededRandom(`${protocol.randomization_seed}:contexts`));
  return contextOrder.map((source_context_index, execution_index) => {
    const rotation = execution_index % base.length;
    let condition_order = [...base.slice(rotation), ...base.slice(0, rotation)];
    if (Math.floor(execution_index / base.length) % 2) condition_order = condition_order.toReversed();
    return { execution_index, source_context_index, condition_order };
  });
}

export function strongCandidateRanks(context) {
  return context.ladder.candidates.filter(candidate => candidate.stratum !== "near_zero")
    .map(candidate => candidate.rank);
}

export function ruleDirections(context, epsilon = RULE_FACTORIAL_PROTOCOL.direction_epsilon) {
  return context.ladder.candidates.map(candidate => {
    const delta = -candidate.local_logit_derivative;
    return delta > epsilon ? "rise" : delta < -epsilon ? "fall" : "stable";
  });
}

export function directionalEndpoints(context, prediction) {
  const actual = context.outcome.directions_by_candidate_rank;
  const prescribed = ruleDirections(context);
  const strong = new Set(strongCandidateRanks(context));
  const indices = context.ladder.candidates.map((_, index) => index);
  const accuracy = selected => selected.filter(index => prediction[index] === actual[index]).length / selected.length;
  const fidelity = selected => selected.filter(index => prediction[index] === prescribed[index]).length / selected.length;
  const strongIndices = indices.filter(index => strong.has(index + 1));
  const nullIndices = indices.filter(index => !strong.has(index + 1));
  return {
    strong_causal_accuracy: accuracy(strongIndices),
    strong_rule_fidelity: fidelity(strongIndices),
    all_coordinate_causal_accuracy: accuracy(indices),
    near_zero_causal_accuracy: accuracy(nullIndices),
    near_zero_rule_fidelity: fidelity(nullIndices)
  };
}

