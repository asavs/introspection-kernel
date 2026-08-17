import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_FACTORIAL_V2 as P, buildRuleFactorialV2Schedule }
  from "./rule_given_factorial_v2_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(moduleDir, "runs", P.source_run_id, "artifact.json");
const predecessorPath = path.join(moduleDir, "runs", P.predecessor_run_id, "artifact.json");
const output = path.join(moduleDir, "preregistrations", `${P.run_id}.json`);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (source.context_count !== P.context_count) throw new Error("source context count mismatch");

const ruleText = [
  "The reported local_logit_derivative is d(logit)/d(scale), centered near head scale 1.",
  "The requested intervention changes scale from 1 to 0.",
  "Under the first-order local approximation, delta_logit is approximately (0 - 1) * local_logit_derivative = -local_logit_derivative.",
  "Therefore a sufficiently positive derivative predicts a fall, and a sufficiently negative derivative predicts a rise.",
  `Use stable only when the predicted delta magnitude is at most ${P.direction_epsilon}.`
].join(" ");

const syntheticDryRun = {
  intervention: { start_scale: 1, requested_scale: 0, direction_epsilon: P.direction_epsilon },
  candidates: [
    { candidate_rank: 1, local_logit_derivative: 1.2, stratum: "positive_1" },
    { candidate_rank: 2, local_logit_derivative: -1.4, stratum: "negative_1" },
    { candidate_rank: 3, local_logit_derivative: 0, stratum: "near_zero" },
    { candidate_rank: 4, local_logit_derivative: 0.8, stratum: "positive_2" },
    { candidate_rank: 5, local_logit_derivative: -0.9, stratum: "negative_2" }
  ]
};

const preregistration = {
  ...P,
  sealed_at: new Date().toISOString(),
  thesis_question: "When irrelevant rank work is removed, thought is explicitly externalized, and calculator use is guaranteed, can Qwen3-8B execute the supplied scale-zero JVP rule?",
  predecessor: {
    run_id: P.predecessor_run_id,
    artifact_sha256: sha256(fs.readFileSync(predecessorPath)),
    result: "best arm 47.5% strong rule fidelity and 40% causal accuracy; thinking commonly derived the rule but starved before recorder; calculator uptake zero",
    status: "qualified preregistered pilot due post-checkpoint serializer compatibility fixes"
  },
  source: {
    artifact: path.relative(moduleDir, sourcePath).replaceAll("\\", "/"),
    artifact_sha256: sha256(fs.readFileSync(sourcePath)),
    completed_before_preregistration: true,
    reuse_policy: "new prospective model predictions against previously sealed outcomes; no outcome field is included in model requests"
  },
  design: {
    factorial: "2 rule (withheld/given) x 2 thinking transcript (absent/present) x 2 forced calculator (absent/present)",
    qwen_predictions: 160,
    predictions_per_condition: 20,
    exact_rule_text: ruleText,
    model_facing_evidence: "only start/requested scale, direction epsilon, and the five candidate rank/token/baseline/JVP/stratum records; high-dimensional ladder summaries are omitted",
    thinking_stage: `thinking cells receive the evidence with enable_thinking=true and max_tokens=${P.thinking_max_tokens}, with no tools; reasoning_content and content are externally captured verbatim`,
    transcript_transfer: "the recorder/calculator sees the preceding model-generated reasoning_content and content verbatim inside a provenance-labeled tool result; no controller summary or answer is added",
    calculator_stage: `calculator cells must make exactly one call because calculate_vector is the only offered tool and tool_choice=required; max_tokens=${P.calculator_max_tokens}`,
    calculator_operations: ["negate", "multiply_scalar", "add_scalar", "classify_threshold"],
    calculator_scope: "pure arithmetic over caller-supplied arrays; no files, network, traces, outcome access, or operation chosen by the controller",
    recorder_stage: `all cells end with enable_thinking=false, max_tokens=${P.recorder_max_tokens}, only record_directions offered, and tool_choice=required`,
    output: "exactly five rise/fall/stable directions; no delta ranking, post-intervention ranking, or largest-change fields",
    randomization: "sealed source-context order and rotated/reversed condition order; every condition occupies each serial position two or three times"
  },
  pre_prediction_gates: {
    unit_tests: "schedule balance, factor decoding, tool arithmetic, recorder validation, endpoint scoring, and assembly",
    synthetic_live_dry_run: syntheticDryRun,
    requirements: [
      "all eight synthetic conditions return a valid five-direction recorder call",
      "every calculator condition contains exactly one successful calculate_vector invocation and every no-calculator condition contains zero",
      "every thinking condition yields a nonempty verbatim transcript and does not finish by length",
      "no-thinking conditions contain no thinking-stage request",
      "all source-context prompt constructions contain no outcome-bearing key and fit the 8192-token context"
    ],
    failure_action: "abort V2 before experimental prediction 1; do not patch V2 after a failed live dry run; preregister a successor"
  },
  endpoints: {
    primary: "causal direction accuracy on four strong signed coordinates",
    execution_diagnostic: "agreement with sign(-JVP) on four strong signed coordinates",
    secondary: ["all-five causal accuracy", "near-zero accuracy and fidelity", "thinking completion/length", "calculator operation and result fidelity", "invalid-stage frequency"]
  },
  confirmatory_contrasts: {
    rule_at_minimal_execution: "rule1_think0_calc0 minus rule0_think0_calc0",
    thinking_with_rule: "mean(rule1_think1_calc0,rule1_think1_calc1) minus mean(rule1_think0_calc0,rule1_think0_calc1)",
    calculator_with_rule: "mean(rule1_think0_calc1,rule1_think1_calc1) minus mean(rule1_think0_calc0,rule1_think1_calc0)",
    testing: "one-sided exact paired sign-flip tests on strong causal accuracy; Holm familywise alpha .05 across three contrasts",
    descriptive: ["rule main effect on causal accuracy", "rule main effect on rule fidelity", "factor interactions"]
  },
  decision_rules: {
    clean_execution_success: "any rule-given cell reaches >=.90 strong rule fidelity and >=.70 strong causal accuracy",
    thought_transfer_rescue: "a rule-given thinking cell reaches success while its matched no-thinking cell does not",
    calculator_rescue: "a rule-given calculator cell reaches success while its matched no-calculator cell does not",
    persistent_execution_failure: "every rule-given cell remains below .90 strong rule fidelity despite passed manipulation gates",
    spontaneous_discovery: "a rule-withheld cell reaches >=.90 strong rule fidelity"
  },
  invalid_output_policy: {
    model_stage_error: "retain exact error and score the five-direction prediction as all incorrect/fidelity zero; do not replace the trial",
    infrastructure_transport_error: "one exact-request retry is allowed; abort if the identical retry also fails",
    no_post_prediction_code_changes: "after experimental prediction 1, any required runner change aborts V2 rather than mixing implementations"
  },
  controls: [
    "source artifact and predecessor hashes sealed",
    "same evidence and candidate order across eight cells within each context",
    "fresh Qwen3-8B runtime before every condition",
    "thinking transcript transferred verbatim and provenance labeled",
    "forced calculator manipulation with exactly one model-chosen operation",
    "directions-only recorder with one immutable schema",
    "all 160 checkpoints sealed before aggregate scoring",
    "external exact-request audit and independent recomputation"
  ],
  stopping_rule: "run all 20 contexts and 160 conditions; no aggregate score inspection before every checkpoint exists",
  randomization: { schedule: buildRuleFactorialV2Schedule() },
  interpretation_boundary: [
    "This is a deliberately simplified execution positive control, not natural introspection or consciousness evidence.",
    "Success shows use of an engineered JVP channel under explicit guidance; it does not show spontaneous discovery.",
    "Failure after passed thought-transfer and forced-calculator gates is stronger evidence of a representation/readout/action limitation for this model and interface."
  ]
};

if (process.argv.includes("--verify")) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  if (existing.source.artifact_sha256 !== sha256(fs.readFileSync(sourcePath))) throw new Error("source hash drift");
  if (existing.predecessor.artifact_sha256 !== sha256(fs.readFileSync(predecessorPath))) throw new Error("predecessor hash drift");
  if (JSON.stringify(existing.randomization.schedule) !== JSON.stringify(buildRuleFactorialV2Schedule())) throw new Error("schedule drift");
  if (existing.design.exact_rule_text !== ruleText) throw new Error("rule text drift");
  console.log(`verified ${output}`);
} else {
  fs.writeFileSync(output, `${JSON.stringify(preregistration, null, 2)}\n`, { flag: "wx" });
  console.log(output);
}
