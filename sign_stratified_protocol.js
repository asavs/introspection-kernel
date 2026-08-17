import {
  seededRandom, shuffle, direction, scoreCategoricalPrediction, exactPairedPermutationPValue
} from "./deep_practice_protocol.js";

export const SIGN_PROTOCOL = Object.freeze({
  schema: "ik.sign-stratified-practice-preregistration.v1",
  run_id: "sign-stratified-practice-preregistered-20260816-001",
  randomization_seed: "ik-sign-stratified-practice-v1-20260816",
  target: Object.freeze({ layer: 35, head: 25, ablation_scale: 0, jvp_epsilon: 0.05 }),
  practice_episode_count: 5,
  heldout_context_count: 20,
  model_conditions: Object.freeze([
    "matched_practice", "outcome_shuffled_practice", "no_practice"
  ]),
  heuristic_conditions: Object.freeze(["all_rise", "negative_jvp_sign"]),
  direction_epsilon: 0.05,
  primary_endpoint: "macro_direction_accuracy",
  secondary_endpoint: "delta_rank_spearman"
});

export function buildSignSchedule(protocol = SIGN_PROTOCOL) {
  const random = seededRandom(protocol.randomization_seed);
  const heldoutOrder = shuffle([...Array(protocol.heldout_context_count).keys()], random);
  const latin = [
    ["matched_practice", "outcome_shuffled_practice", "no_practice"],
    ["outcome_shuffled_practice", "no_practice", "matched_practice"],
    ["no_practice", "matched_practice", "outcome_shuffled_practice"],
    ["matched_practice", "no_practice", "outcome_shuffled_practice"],
    ["no_practice", "outcome_shuffled_practice", "matched_practice"],
    ["outcome_shuffled_practice", "matched_practice", "no_practice"]
  ];
  const conditionOrders = shuffle([...latin, ...latin, ...latin, latin[0], latin[1]], random);
  const rotations = shuffle([...Array(protocol.practice_episode_count).keys()]
    .flatMap(rotation => Array(protocol.heldout_context_count / protocol.practice_episode_count).fill(rotation)), random);
  const shuffleOffsets = shuffle([1, 2, 3, 4].flatMap(offset => Array(5).fill(offset)), random);
  const heldoutPanelPermutations = [...Array(protocol.heldout_context_count)].map((_, index) =>
    shuffle([0, 1, 2, 3, 4], seededRandom(`${protocol.randomization_seed}:heldout-panel:${index}`)));
  const practicePanelPermutations = [...Array(protocol.practice_episode_count)].map((_, index) =>
    shuffle([0, 1, 2, 3, 4], seededRandom(`${protocol.randomization_seed}:practice-panel:${index}`)));

  return heldoutOrder.map((heldoutIndex, executionIndex) => {
    const practiceOrder = [...Array(protocol.practice_episode_count).keys()]
      .map(index => (index + rotations[executionIndex]) % protocol.practice_episode_count);
    const offset = shuffleOffsets[executionIndex];
    return {
      execution_index: executionIndex,
      heldout_index: heldoutIndex,
      condition_order: conditionOrders[executionIndex],
      practice_order: practiceOrder,
      shuffled_outcome_order: practiceOrder.map((_, position) =>
        practiceOrder[(position + offset) % practiceOrder.length]),
      heldout_panel_permutation: heldoutPanelPermutations[heldoutIndex]
    };
  }).map(item => ({ ...item, practice_panel_permutations: practicePanelPermutations }));
}

export function canonicalSignPanel(jvp) {
  const positive = jvp.top_positive_coordinates?.slice(0, 2) ?? [];
  const negative = jvp.top_negative_coordinates?.slice(0, 2) ?? [];
  const zero = jvp.closest_to_zero_coordinates?.slice(0, 1) ?? [];
  if (positive.length !== 2 || negative.length !== 2 || zero.length !== 1) {
    throw new Error("signed JVP selector did not return a complete 2/2/1 panel");
  }
  return [
    ...positive.map((item, index) => ({ ...item, stratum: `positive_${index + 1}` })),
    ...negative.map((item, index) => ({ ...item, stratum: `negative_${index + 1}` })),
    { ...zero[0], stratum: "near_zero" }
  ];
}

export function permutePanel(canonical, permutation) {
  if ([...permutation].sort().join(",") !== "0,1,2,3,4") throw new Error("invalid panel permutation");
  return permutation.map((canonicalIndex, presentedIndex) => ({
    ...canonical[canonicalIndex], canonical_index: canonicalIndex, rank: presentedIndex + 1
  }));
}

export function heuristicPredictions(candidates) {
  const negativeJvpDeltas = candidates.map(item => -item.local_logit_derivative);
  return {
    all_rise: {
      directions_by_candidate_rank: candidates.map(() => "rise"),
      predicted_delta_order_largest_to_smallest: candidates.map(item => item.rank),
      predicted_post_intervention_order_highest_to_lowest: candidates
        .toSorted((left, right) => right.baseline_logit - left.baseline_logit).map(item => item.rank),
      largest_rise_candidate_rank: 1,
      largest_fall_candidate_rank: 5
    },
    negative_jvp_sign: {
      directions_by_candidate_rank: negativeJvpDeltas.map(value => direction(value)),
      predicted_delta_order_largest_to_smallest: negativeJvpDeltas.map((value, index) => ({ value, rank: index + 1 }))
        .sort((a, b) => b.value - a.value).map(item => item.rank),
      predicted_post_intervention_order_highest_to_lowest: candidates
        .map((item, index) => ({ value: item.baseline_logit + negativeJvpDeltas[index], rank: index + 1 }))
        .sort((a, b) => b.value - a.value).map(item => item.rank),
      largest_rise_candidate_rank: negativeJvpDeltas.indexOf(Math.max(...negativeJvpDeltas)) + 1,
      largest_fall_candidate_rank: negativeJvpDeltas.indexOf(Math.min(...negativeJvpDeltas)) + 1
    }
  };
}

export { direction, scoreCategoricalPrediction, exactPairedPermutationPValue };

