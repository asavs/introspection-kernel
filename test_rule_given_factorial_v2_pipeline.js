import assert from "node:assert/strict";
import { calculateVector, compactEvidence, parseDirections, transcriptFromCompletion }
  from "./rule_given_factorial_v2_pipeline.js";

assert.deepEqual(calculateVector({ operation: "negate", values: [1, -2, 0] }).values, [-1, 2, -0]);
assert.deepEqual(calculateVector({ operation: "multiply_scalar", values: [1, -2], scalar: -1 }).values, [-1, 2]);
assert.deepEqual(calculateVector({ operation: "add_scalar", values: [1, -2], scalar: 3 }).values, [4, 1]);
assert.deepEqual(calculateVector({ operation: "classify_threshold", values: [-1, 0, 1], threshold: .05 }).directions,
  ["fall", "stable", "rise"]);
assert.throws(() => calculateVector({ operation: "negate", values: [] }));
assert.deepEqual(parseDirections({ function: { name: "record_directions",
  arguments: JSON.stringify({ directions_by_candidate_rank: ["rise", "fall", "stable", "rise", "fall"] }) } })
  .directions_by_candidate_rank, ["rise", "fall", "stable", "rise", "fall"]);
assert.throws(() => parseDirections({ function: { name: "record_directions", arguments: "{}" } }));
const evidence = compactEvidence({ ladder: { candidates: [{ rank: 1, local_logit_derivative: 2, stratum: "positive_1" }] } });
assert.equal(evidence.candidates[0].local_logit_derivative, 2);
assert.deepEqual(transcriptFromCompletion({ message: { reasoning_content: "r", content: "c" }, finish_reason: "stop" }),
  { provenance: "verbatim_qwen_preceding_thinking_stage", reasoning_content: "r", content: "c", finish_reason: "stop" });
console.log("rule-given factorial V2 pipeline tests passed");

