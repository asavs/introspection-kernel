import { createHash } from "node:crypto";

export const PROTOCOL = Object.freeze({
  schema: "ik.deep-practice-batch-preregistration.v1",
  run_id: "deep-practice-batch-preregistered-20260816-001",
  randomization_seed: "ik-deep-practice-v1-20260816",
  target: Object.freeze({ layer: 35, head: 25, ablation_scale: 0, jvp_epsilon: 0.05 }),
  practice_episode_count: 5,
  heldout_pair_count: 20,
  conditions: Object.freeze(["matched_practice", "outcome_shuffled_practice"]),
  direction_epsilon: 0.05,
  primary_endpoints: Object.freeze([
    "macro_direction_accuracy",
    "delta_rank_spearman"
  ]),
  secondary_endpoints: Object.freeze([
    "largest_rise_correct",
    "largest_fall_correct",
    "post_intervention_rank_spearman"
  ])
});

function seedWords(seed) {
  const digest = createHash("sha256").update(seed).digest();
  return [0, 4, 8, 12].map(offset => digest.readUInt32LE(offset));
}

export function seededRandom(seed) {
  let [a, b, c, d] = seedWords(seed);
  return () => {
    const t = (b << 9) >>> 0;
    let r = Math.imul(a, 5);
    r = (Math.imul((r << 7) | (r >>> 25), 9)) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
    d = (d << 11) | (d >>> 21);
    return r / 0x100000000;
  };
}

export function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function buildSchedule(protocol = PROTOCOL) {
  const random = seededRandom(protocol.randomization_seed);
  const pairOrder = shuffle([...Array(protocol.heldout_pair_count).keys()], random);
  const conditionFirst = shuffle([
    ...Array(protocol.heldout_pair_count / 2).fill("matched_practice"),
    ...Array(protocol.heldout_pair_count / 2).fill("outcome_shuffled_practice")
  ], random);
  const rotations = shuffle([...Array(protocol.practice_episode_count).keys()]
    .flatMap(rotation => Array(protocol.heldout_pair_count / protocol.practice_episode_count).fill(rotation)), random);
  const shuffleOffsets = shuffle([1, 2, 3, 4].flatMap(offset => Array(5).fill(offset)), random);

  return pairOrder.map((heldoutIndex, executionIndex) => {
    const rotation = rotations[executionIndex];
    const base = [...Array(protocol.practice_episode_count).keys()];
    const practiceOrder = base.map(index => (index + rotation) % base.length);
    const shuffleOffset = shuffleOffsets[executionIndex];
    const shuffledOutcomeOrder = practiceOrder.map((_, presentedIndex) =>
      practiceOrder[(presentedIndex + shuffleOffset) % practiceOrder.length]);
    const first = conditionFirst[executionIndex];
    return {
      execution_index: executionIndex,
      heldout_index: heldoutIndex,
      practice_order: practiceOrder,
      shuffled_outcome_order: shuffledOutcomeOrder,
      condition_order: first === "matched_practice"
        ? ["matched_practice", "outcome_shuffled_practice"]
        : ["outcome_shuffled_practice", "matched_practice"]
    };
  });
}

export function direction(value, epsilon = PROTOCOL.direction_epsilon) {
  return value > epsilon ? "rise" : value < -epsilon ? "fall" : "stable";
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const result = Array(values.length);
  for (let begin = 0; begin < sorted.length;) {
    let end = begin + 1;
    while (end < sorted.length && sorted[end].value === sorted[begin].value) end += 1;
    const rank = (begin + end - 1) / 2 + 1;
    for (let cursor = begin; cursor < end; cursor += 1) result[sorted[cursor].index] = rank;
    begin = end;
  }
  return result;
}

function correlation(left, right) {
  const aMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const bMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0; let a2 = 0; let b2 = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - aMean; const b = right[index] - bMean;
    numerator += a * b; a2 += a * a; b2 += b * b;
  }
  return a2 && b2 ? numerator / Math.sqrt(a2 * b2) : 0;
}

export function scoreCategoricalPrediction(prediction, actualDeltas, baselineLogits) {
  const actualDirections = actualDeltas.map(value => direction(value));
  const directionCorrect = prediction.directions_by_candidate_rank.map((value, index) =>
    value === actualDirections[index]);
  const largestRise = actualDeltas.indexOf(Math.max(...actualDeltas)) + 1;
  const largestFall = actualDeltas.indexOf(Math.min(...actualDeltas)) + 1;
  const actualPost = baselineLogits.map((value, index) => value + actualDeltas[index]);
  const orderScores = order => {
    const scores = Array(order.length);
    order.forEach((candidateRank, position) => { scores[candidateRank - 1] = order.length - position; });
    return scores;
  };
  const predictedDeltaRanks = orderScores(prediction.predicted_delta_order_largest_to_smallest);
  const predictedPostRanks = orderScores(prediction.predicted_post_intervention_order_highest_to_lowest);
  return {
    actual_directions: actualDirections,
    direction_correct: directionCorrect,
    macro_direction_accuracy: directionCorrect.filter(Boolean).length / actualDeltas.length,
    delta_rank_spearman: correlation(predictedDeltaRanks, ranks(actualDeltas)),
    post_intervention_rank_spearman: correlation(predictedPostRanks, ranks(actualPost)),
    largest_rise_correct: prediction.largest_rise_candidate_rank === largestRise,
    largest_fall_correct: prediction.largest_fall_candidate_rank === largestFall
  };
}

export function exactPairedPermutationPValue(differences) {
  if (differences.length > 24) throw new Error("exact enumeration is capped at 24 pairs");
  const observed = differences.reduce((sum, value) => sum + value, 0);
  let atLeastObserved = 0;
  const assignments = 2 ** differences.length;
  for (let mask = 0; mask < assignments; mask += 1) {
    let signed = 0;
    for (let index = 0; index < differences.length; index += 1) {
      signed += (mask & (2 ** index)) ? differences[index] : -differences[index];
    }
    if (signed >= observed - 1e-12) atLeastObserved += 1;
  }
  return atLeastObserved / assignments;
}
