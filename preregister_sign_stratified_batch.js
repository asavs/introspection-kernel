import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGN_PROTOCOL, buildSignSchedule } from "./sign_stratified_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(moduleDir, "preregistrations", `${SIGN_PROTOCOL.run_id}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const preregistration = {
  ...SIGN_PROTOCOL,
  sealed_at: "2026-08-16T19:45:00.000-07:00",
  thesis_question: "Can Qwen use correctly paired causal practice to read a directionally balanced internal logit-JVP channel better than shuffled or absent practice?",
  sampling_unit: "one fresh held-out transformer computation evaluated under all three model conditions and both deterministic heuristics",
  sample_size: { heldout_contexts: 20, predictions_per_model_condition: 20,
    total_qwen_predictions: 60, heuristic_evaluations_per_condition: 20 },
  candidate_selection: {
    pre_outcome_rule: [
      "two vocabulary coordinates with the largest positive local logit derivative",
      "two vocabulary coordinates with the most negative local logit derivative",
      "one vocabulary coordinate with derivative closest to zero"
    ],
    derivative: "centered finite difference from head scales 0.95 and 1.05",
    presentation: "apply the sealed per-context random permutation after selection so candidate rank does not reveal stratum",
    expected_scale_zero_direction: "sign(-local_logit_derivative)",
    scale_zero_outcome_available_during_selection: false
  },
  model_conditions: {
    matched_practice: "five causal ladders paired with their own scale-zero outcome",
    outcome_shuffled_practice: "identical evidence/outcome multisets with episode outcomes assigned by a derangement",
    no_practice: "identical held-out evidence and task schema with no practice examples"
  },
  heuristic_conditions: {
    all_rise: "predict rise at every candidate; rank fields are not confirmatory",
    negative_jvp_sign: "predict direction and ordering from negative local derivative"
  },
  practice_diversity_gate: {
    evaluated_before_any_new_heldout_scale_zero_outcome: true,
    requirements: [
      "at least five rise and five fall outcomes across the 25 practice candidates",
      "at least three distinct categorical outcome vectors across five practice episodes",
      "every practice panel contains two positive-JVP, two negative-JVP, and one near-zero coordinate"
    ],
    action_if_failed: "abort the confirmatory batch and revise the curriculum; do not replace practice examples after seeing held-out outcomes"
  },
  scoring: {
    primary_endpoint: "macro direction accuracy over five candidates using rise/fall/stable relative to baseline",
    direction_rule: `rise if delta > ${SIGN_PROTOCOL.direction_epsilon}; fall if delta < -${SIGN_PROTOCOL.direction_epsilon}; otherwise stable`,
    confirmatory_contrasts: ["matched minus outcome-shuffled", "matched minus no-practice"],
    test: "one-sided exact paired sign-flip permutation test for each contrast",
    multiplicity: "Holm step-down familywise alpha 0.05 across the two confirmatory contrasts",
    secondary_endpoint: "delta-rank Spearman; descriptive unless primary family rejects",
    benchmarks: ["all-rise direction accuracy", "negative-JVP-sign direction accuracy"],
    progress_rule: "matched must exceed shuffled, no-practice, and all-rise; report its gap to negative-JVP-sign without claiming access if it remains substantially worse"
  },
  controls: [
    "matched and shuffled prompts have identical token counts and evidence/outcome multisets",
    "every shuffled episode mapping is a derangement",
    "model-condition order is Latin-balanced to within one position",
    "practice serial position is exactly balanced",
    "runtime is restarted before every capture and prediction",
    "all three Qwen predictions are sealed before sham or scale-zero is generated",
    "scale-one sham must be identical over all 151936 logits"
  ],
  exclusions: [
    "capture missed the first-token decode or preregistered position",
    "intervention target provenance differs in layer, head, position, or scale",
    "full-vocabulary scale-one sham is nonzero",
    "matched and shuffled prompt token counts differ",
    "structured model prediction is invalid"
  ],
  stopping_rule: "run all 20 held-out contexts; do not inspect condition aggregates or stop early",
  randomization: { algorithm: "seeded xoshiro128** with Latin/balanced allocations", schedule: buildSignSchedule() },
  interpretation_boundary: [
    "Matched-over-controls improvement supports learned use of the supplied causal representation, not consciousness.",
    "Negative-JVP-sign performance establishes information availability but is not itself model introspection.",
    "Failure remains evidence about this model, representation, and curriculum rather than an architectural impossibility result."
  ]
};
if (process.argv.includes("--verify")) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  if (JSON.stringify(existing.randomization.schedule) !== JSON.stringify(buildSignSchedule())) throw new Error("sealed schedule drifted");
  console.log(`verified ${output}`);
} else {
  fs.writeFileSync(output, `${JSON.stringify(preregistration, null, 2)}\n`, { flag: "wx" });
  console.log(output);
}
