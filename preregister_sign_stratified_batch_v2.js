import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGN_PROTOCOL_V2, buildSignScheduleV2, buildPracticePoolPermutations } from "./sign_stratified_protocol_v2.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(moduleDir, "preregistrations", `${SIGN_PROTOCOL_V2.run_id}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const preregistration = {
  ...SIGN_PROTOCOL_V2,
  sealed_at: "2026-08-16T20:30:00.000-07:00",
  predecessor: {
    run_id: "sign-stratified-practice-preregistered-20260816-001",
    status: "aborted_before_new_heldout_capture",
    reason: "preregistered practice gate required at least five falls; observed training-only counts were 13 rise, 4 fall, 8 stable"
  },
  thesis_question: "Can Qwen use correctly paired, directionally diverse causal practice to read a balanced internal logit-JVP channel better than shuffled or absent practice?",
  sample_size: { heldout_contexts: 20, predictions_per_model_condition: 20,
    total_qwen_predictions: 60, heuristic_evaluations_per_condition: 20 },
  heldout_candidate_selection: {
    unchanged_from_v1: true,
    rule: "two largest positive JVP, two most negative JVP, one closest-to-zero JVP; then apply sealed random presentation permutation",
    uses_scale_zero_outcome: false
  },
  practice_pool: {
    source: "five prior deep-practice training computations plus twenty prior deep-practice held-out computations; all completed before this preregistration",
    count: 25,
    new_confirmatory_context_overlap: 0,
    panel_permutations: buildPracticePoolPermutations(),
    selection_algorithm: [
      "construct the same 2-positive/2-negative/1-null randomized panel for every pool computation",
      "enumerate every five-computation subset",
      "maximize min(total rise,total fall)",
      "then maximize number of distinct five-direction outcome vectors",
      "then minimize absolute distance between stable count and five",
      "then choose lexicographically smallest source-index tuple"
    ],
    selection_uses: "training outcomes only",
    selection_does_not_use: "any new held-out prompt, trace, prediction, sham, or outcome"
  },
  practice_diversity_gate: {
    evaluated_before_any_new_heldout_capture: true,
    requirements: [
      "at least five rise and five fall outcomes across selected 25 practice candidates",
      "at least three distinct categorical outcome vectors",
      "every panel contains two positive-JVP, two negative-JVP, and one near-zero coordinate"
    ],
    action_if_failed: "abort v2 before new held-out capture"
  },
  model_conditions: {
    matched_practice: "five selected causal ladders paired with their own outcomes",
    outcome_shuffled_practice: "same evidence/outcome multisets with episode outcomes deranged",
    no_practice: "held-out evidence and task schema without examples"
  },
  heuristic_conditions: {
    all_rise: "predict rise at every candidate",
    negative_jvp_sign: "predict scale-zero direction and rank from negative local JVP"
  },
  scoring: {
    primary_endpoint: "macro rise/fall/stable direction accuracy with epsilon 0.05",
    confirmatory_contrasts: ["matched minus outcome-shuffled", "matched minus no-practice"],
    tests: "one-sided exact paired sign-flip permutation tests",
    multiplicity: "Holm familywise alpha 0.05 across two contrasts",
    secondary: "delta-rank Spearman",
    progress_rule: "matched exceeds shuffled, no-practice, and all-rise; negative-JVP gap is always reported"
  },
  controls: [
    "matched/shuffled prompt token parity and identical evidence/outcome multisets",
    "deranged shuffled mapping",
    "Latin-balanced model-condition order",
    "balanced practice serial position",
    "runtime restart before every capture and prediction",
    "all three predictions sealed before sham and scale-zero",
    "full-vocabulary scale-one identity"
  ],
  exclusions: ["position mismatch", "target provenance mismatch", "nonzero sham",
    "matched/shuffled prompt token mismatch", "invalid structured prediction"],
  stopping_rule: "run all 20; no interim aggregate inspection",
  randomization: { schedule: buildSignScheduleV2() },
  interpretation_boundary: [
    "Improvement supports learned use of the supplied representation, not consciousness.",
    "The curriculum is deliberately selected using old training outcomes and must not be described as natural discovery.",
    "Negative-JVP performance demonstrates channel information, not model access by itself."
  ]
};
if (process.argv.includes("--verify")) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  if (JSON.stringify(existing.randomization.schedule) !== JSON.stringify(buildSignScheduleV2())) throw new Error("schedule drift");
  if (JSON.stringify(existing.practice_pool.panel_permutations) !== JSON.stringify(buildPracticePoolPermutations())) throw new Error("pool permutation drift");
  console.log(`verified ${output}`);
} else {
  fs.writeFileSync(output, `${JSON.stringify(preregistration, null, 2)}\n`, { flag: "wx" });
  console.log(output);
}

