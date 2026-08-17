import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_FACTORIAL_V3 as P, buildRuleFactorialV3Schedule }
  from "./rule_given_factorial_v3_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(moduleDir, "runs", P.source_run_id, "artifact.json");
const v2Dir = path.join(moduleDir, "runs", P.aborted_predecessor_run_id);
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
const synthetic = {
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
  thesis_question: "With calculator-before-thinking ordering, verbatim completed-thought transfer, and a directions-only recorder, can Qwen3-8B execute the supplied scale-zero JVP rule?",
  predecessor_abort: {
    run_id: P.aborted_predecessor_run_id,
    abort_sha256: sha256(fs.readFileSync(path.join(v2Dir, "abort.json"))),
    dry_run_sha256: sha256(fs.readFileSync(path.join(v2Dir, "dry-run.json"))),
    before_experimental_prediction_1: true,
    observed: [
      "directions-only thinking completed normally and contained the correct synthetic direction vector",
      "forced calculator succeeded without a preceding thought transcript",
      "calculator after a thought transcript repeated the correct answer instead of calling the required tool",
      "replayed valid calculator assistant turns used null content rejected by llama.cpp"
    ]
  },
  source: { artifact: path.relative(moduleDir, sourcePath).replaceAll("\\", "/"),
    artifact_sha256: sha256(fs.readFileSync(sourcePath)), completed_before_preregistration: true,
    reuse_policy: "prospective model predictions against sealed outcomes; outcome fields never enter requests" },
  design: {
    factorial: "2 rule (withheld/given) x 2 completed thinking transcript (absent/present) x 2 forced calculator (absent/present)",
    qwen_predictions: 160, predictions_per_condition: 20, exact_rule_text: ruleText,
    evidence: "intervention scales, epsilon, and five candidate rank/token/baseline/JVP/stratum records only",
    stage_order: "forced calculator if assigned; isolated thinking if assigned; directions-only recorder",
    calculator: `calculate_vector is the only tool with tool_choice=required and max_tokens=${P.calculator_max_tokens}; Qwen chooses negate, multiply_scalar, add_scalar, or classify_threshold and all arguments`,
    calculator_replay: "valid calculator assistant content is normalized from null to the empty string solely for llama.cpp message compatibility; tool call and tool result are otherwise exact",
    thinking: `enable_thinking=true, no tools, max_tokens=${P.thinking_max_tokens}; it sees the authentic calculator exchange when assigned`,
    thought_transfer: "reasoning_content and content are captured verbatim in a provenance-labeled tool result; no controller interpretation",
    recorder: `enable_thinking=false, record_directions is the only tool, tool_choice=required, max_tokens=${P.recorder_max_tokens}`,
    output: "five rise/fall/stable labels only",
    randomization: "sealed context order plus rotated/reversed condition order"
  },
  pre_prediction_gates: {
    synthetic_live_dry_run: synthetic,
    requirements: [
      "all eight recorder calls valid",
      "exactly one successful calculator invocation in calculator cells and zero in others",
      "all thinking cells yield nonempty transcripts and finish without length",
      "calculator-before-thinking exchange replays successfully with content normalized only null-to-empty-string",
      "all twenty source prompt families contain no outcome key and fit context"
    ],
    failure_action: "abort V3 before prediction 1; no post-gate patching"
  },
  endpoints: {
    primary: "causal direction accuracy on four strong signed coordinates",
    execution_diagnostic: "sign(-JVP) agreement on four strong signed coordinates",
    secondary: ["all-five and near-zero accuracy/fidelity", "thinking completion", "calculator operation/result fidelity", "invalid-stage rate"]
  },
  confirmatory_contrasts: {
    rule_at_minimal_execution: "rule1_think0_calc0 minus rule0_think0_calc0",
    thinking_with_rule: "mean(rule1_think1_calc0,rule1_think1_calc1) minus mean(rule1_think0_calc0,rule1_think0_calc1)",
    calculator_with_rule: "mean(rule1_think0_calc1,rule1_think1_calc1) minus mean(rule1_think0_calc0,rule1_think1_calc0)",
    testing: "one-sided exact paired sign-flip tests; Holm familywise alpha .05"
  },
  decision_rules: {
    clean_execution_success: "any rule-given cell reaches >=.90 strong rule fidelity and >=.70 causal accuracy",
    thought_transfer_rescue: "a rule-given thinking cell succeeds while matched no-thinking does not",
    calculator_rescue: "a rule-given calculator cell succeeds while matched no-calculator does not",
    persistent_execution_failure: "all rule-given cells remain below .90 fidelity after manipulation gates pass",
    spontaneous_discovery: "a rule-withheld cell reaches >=.90 fidelity"
  },
  invalid_output_policy: {
    model_stage_error: "retain and score five directions all incorrect/fidelity zero; never replace",
    infrastructure_transport_error: "one identical-request retry, then abort",
    after_prediction_1: "any required code change aborts the batch"
  },
  stopping_rule: "all twenty contexts and 160 predictions; no interim aggregate scoring",
  randomization: { schedule: buildRuleFactorialV3Schedule() },
  interpretation_boundary: [
    "This simplified task is an engineered execution positive control, not natural introspection or consciousness evidence.",
    "Success demonstrates guided use of a JVP channel, not spontaneous discovery.",
    "Failure after passed calculator and thought-transfer gates strengthens an interface/readout limitation localized to this model and task."
  ]
};

if (process.argv.includes("--verify")) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  if (existing.source.artifact_sha256 !== sha256(fs.readFileSync(sourcePath))) throw new Error("source drift");
  if (existing.predecessor_abort.abort_sha256 !== sha256(fs.readFileSync(path.join(v2Dir, "abort.json")))) throw new Error("abort drift");
  if (existing.predecessor_abort.dry_run_sha256 !== sha256(fs.readFileSync(path.join(v2Dir, "dry-run.json")))) throw new Error("dry-run drift");
  if (JSON.stringify(existing.randomization.schedule) !== JSON.stringify(buildRuleFactorialV3Schedule())) throw new Error("schedule drift");
  console.log(`verified ${output}`);
} else {
  fs.writeFileSync(output, `${JSON.stringify(preregistration, null, 2)}\n`, { flag: "wx" });
  console.log(output);
}
