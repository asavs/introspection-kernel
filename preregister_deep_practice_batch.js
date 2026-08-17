import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL, buildSchedule } from "./deep_practice_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(moduleDir, "preregistrations", `${PROTOCOL.run_id}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
if (fs.existsSync(output) && !process.argv.includes("--verify")) {
  throw new Error(`refusing to overwrite sealed preregistration: ${output}`);
}
const preregistration = {
  ...PROTOCOL,
  sealed_at: "2026-08-16T23:45:00.000-07:00",
  thesis_question: "Can Qwen use a correctly paired history of causal evidence from its own transformer computations better than an outcome-shuffled sham history?",
  sampling_unit: "one fresh held-out transformer computation, evaluated once under both practice conditions",
  sample_size: { heldout_pairs: 20, predictions_per_condition: 20, total_blinded_predictions: 40 },
  evidence_ladder: [
    "full_128_coordinate_head_activation",
    "separate_4096_coordinate_projected_head_contribution",
    "4096_coordinate_final_mlp_residual_delta",
    "4096_coordinate_final_normalized_residual_delta",
    "local_logit_jvp_centered_finite_difference"
  ],
  candidate_rule: "top five absolute local-logit-JVP coordinates, selected before the held-out scale-zero outcome exists",
  outcome: "scale-zero minus baseline raw-logit delta at the five frozen candidate coordinates",
  scoring_rule: {
    primary: PROTOCOL.primary_endpoints,
    secondary: PROTOCOL.secondary_endpoints,
    exact_float_mse_is_primary: false,
    directional_classes: `rise if delta > ${PROTOCOL.direction_epsilon}; fall if delta < -${PROTOCOL.direction_epsilon}; otherwise stable`,
    confirmatory_test: "one-sided exact paired sign-flip permutation test on matched-minus-shuffled pair scores",
    alpha: 0.05,
    multiplicity: "report both primary endpoints; macro direction accuracy is the lead endpoint"
  },
  randomization: {
    algorithm: "seeded xoshiro128** plus balanced allocations",
    schedule: buildSchedule(),
    requirements: [
      "ten matched-first and ten shuffled-first pairs",
      "each practice episode appears four times in every serial position",
      "every shuffled mapping is a derangement",
      "matched and shuffled prompts use the identical evidence and outcome multisets"
    ]
  },
  exclusions: [
    "capture failed to land on the preregistered first-token decode position",
    "scale-one sham changes any final logit",
    "intervention provenance is absent or targets the wrong layer, head, position, or scale",
    "paired prompt token counts differ",
    "structured prediction is invalid after one deterministic retry"
  ],
  stopping_rule: "run all 20 preregistered pairs; do not stop for interim results",
  provenance_boundary: "all predictions for a pair are sealed before its scale-one sham and scale-zero outcome are generated",
  interpretation_boundary: [
    "Matched-over-shuffled performance supports sensitivity to correct causal pairing under this representation.",
    "It does not establish consciousness, phenomenal experience, or unaided discovery of the instrumentation.",
    "A null result remains ambiguous between absent use and an insufficient model-facing evidence representation."
  ]
};
if (process.argv.includes("--verify")) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  assertSchedule(existing.randomization.schedule);
  console.log(`verified ${output}`);
} else {
  fs.writeFileSync(output, `${JSON.stringify(preregistration, null, 2)}\n`, { flag: "wx" });
  console.log(output);
}

function assertSchedule(schedule) {
  if (JSON.stringify(schedule) !== JSON.stringify(buildSchedule())) throw new Error("sealed schedule drifted");
}
