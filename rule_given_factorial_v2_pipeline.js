import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(
  typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)
).digest("hex");

export function compactEvidence(context, directionEpsilon = 0.05) {
  return {
    intervention: { target: "layer 35 head 25", start_scale: 1, requested_scale: 0,
      direction_epsilon: directionEpsilon },
    candidates: context.ladder.candidates.map(candidate => ({
      candidate_rank: candidate.rank,
      token_id: candidate.token_id ?? null,
      token: candidate.token ?? null,
      baseline_logit: candidate.baseline_logit ?? null,
      local_logit_derivative: candidate.local_logit_derivative,
      stratum: candidate.stratum
    }))
  };
}

export function calculateVector(args) {
  if (!args || !Array.isArray(args.values) || args.values.length < 1 || args.values.length > 8
      || !args.values.every(Number.isFinite)) throw new Error("values must contain 1-8 finite numbers");
  if (args.operation === "negate") return { operation: args.operation, values: args.values.map(value => -value) };
  if (args.operation === "multiply_scalar") {
    if (!Number.isFinite(args.scalar)) throw new Error("finite scalar required");
    return { operation: args.operation, values: args.values.map(value => value * args.scalar) };
  }
  if (args.operation === "add_scalar") {
    if (!Number.isFinite(args.scalar)) throw new Error("finite scalar required");
    return { operation: args.operation, values: args.values.map(value => value + args.scalar) };
  }
  if (args.operation === "classify_threshold") {
    if (!Number.isFinite(args.threshold) || args.threshold < 0) throw new Error("nonnegative threshold required");
    return { operation: args.operation, directions: args.values.map(value =>
      value > args.threshold ? "rise" : value < -args.threshold ? "fall" : "stable") };
  }
  throw new Error("unsupported calculator operation");
}

export function parseDirections(call) {
  if (!call || call.function?.name !== "record_directions") throw new Error("record_directions call missing");
  const parsed = JSON.parse(call.function.arguments);
  if (!Array.isArray(parsed.directions_by_candidate_rank) || parsed.directions_by_candidate_rank.length !== 5
      || !parsed.directions_by_candidate_rank.every(value => ["rise", "fall", "stable"].includes(value))) {
    throw new Error("exactly five valid directions required");
  }
  return parsed;
}

export function transcriptFromCompletion(completion) {
  const message = completion?.message ?? {};
  return { provenance: "verbatim_qwen_preceding_thinking_stage",
    reasoning_content: message.reasoning_content ?? "", content: message.content ?? "",
    finish_reason: completion?.finish_reason ?? null };
}

