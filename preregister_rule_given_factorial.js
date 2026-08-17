import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_FACTORIAL_PROTOCOL as P, buildRuleFactorialSchedule }
  from "./rule_given_factorial_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(moduleDir, "runs", P.source_run_id, "artifact.json");
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

const preregistration = {
  ...P,
  sealed_at: new Date().toISOString(),
  thesis_question: "Does explicitly supplying the scale-zero local-JVP rule enable Qwen3-8B to use a causally informative internal channel, and do thinking or an arithmetic tool improve execution?",
  source: {
    artifact: path.relative(moduleDir, sourcePath).replaceAll("\\", "/"),
    artifact_sha256: sha256(fs.readFileSync(sourcePath)),
    completed_before_preregistration: true,
    reuse_policy: "prospective Qwen predictions against previously sealed causal outcomes; outcome fields are never included in model requests"
  },
  design: {
    factorial: "2 rule (withheld/given) x 2 thinking (disabled/enabled) x 2 auxiliary calculator (absent/available)",
    qwen_predictions: P.context_count * P.conditions.length,
    predictions_per_condition: P.context_count,
    exact_rule_text: ruleText,
    thinking: "Qwen chat-template enable_thinking flag; max_tokens 1024 in every cell",
    calculator: "optional arithmetic-only tool supporting vector linear_delta=(end_scale-start_scale)*derivative, negate, add, and descending_order; it cannot read files, network, traces, or outcomes",
    mandatory_recorder: "all cells receive the same structured record_directional_prediction tool; this is response serialization, not auxiliary calculator access",
    calculator_loop: `when available, use tool_choice auto for at most ${P.max_auxiliary_tool_rounds} rounds; execute calculator calls, accept an early recorder call, and force the recorder after the limit or a tool-free assistant response`,
    randomization: "sealed source-context order and rotated/reversed condition orders; each condition occupies every serial position either two or three times"
  },
  endpoints: {
    primary: "direction accuracy on the four strong signed coordinates, excluding near-zero",
    execution_diagnostic: "agreement with the prescribed sign(-JVP) direction on the four strong signed coordinates",
    secondary: ["all-five direction accuracy", "near-zero accuracy and rule fidelity", "delta-rank Spearman", "tool uptake and reasoning-token counts"]
  },
  confirmatory_contrasts: {
    rule_at_minimal_execution: "rule1_think0_calc0 minus rule0_think0_calc0",
    thinking_with_rule: "mean(rule1_think1_calc0,rule1_think1_calc1) minus mean(rule1_think0_calc0,rule1_think0_calc1)",
    calculator_with_rule: "mean(rule1_think0_calc1,rule1_think1_calc1) minus mean(rule1_think0_calc0,rule1_think1_calc0)",
    testing: "one-sided exact paired sign-flip tests on strong causal accuracy; Holm familywise alpha 0.05 across these three contrasts",
    descriptive: ["rule main effect averaged over thinking/calculator", "rule x thinking", "rule x calculator", "three-way interaction"]
  },
  decision_rules: {
    inference_failure_supported: "a rule-given cell reaches >=0.90 strong rule fidelity and >=0.70 strong causal accuracy while its matched rule-withheld cell does not",
    execution_failure_supported: "every rule-given cell remains below 0.90 strong rule fidelity; causal accuracy alone cannot establish execution failure",
    spontaneous_discovery_supported: "a rule-withheld cell reaches >=0.90 strong rule fidelity without outcome access",
    tool_localization: "calculator improvement with rule indicates arithmetic/orchestration limitation; thinking improvement with rule indicates deliberative execution limitation"
  },
  controls: [
    "identical held-out evidence and candidate order across all eight conditions within context",
    "same 1024 maximum generation tokens in all cells",
    "fresh runtime restart before every condition",
    "no prior practice examples in any cell",
    "all predictions written to condition checkpoints before aggregate scoring",
    "source artifact hash checked before every run and validation",
    "auxiliary calculator is pure arithmetic and has no filesystem or outcome access"
  ],
  exclusions: ["source hash mismatch", "invalid structured prediction", "outcome leakage in request",
    "calculator operation outside sealed schema", "missing condition prediction"],
  stopping_rule: "run all 20 contexts and 160 predictions; do not inspect aggregate scores before completion",
  randomization: { schedule: buildRuleFactorialSchedule() },
  interpretation_boundary: [
    "Rule-following or causal prediction is evidence of access-and-use in this task, not consciousness or phenomenal introspection.",
    "The JVP is an externally engineered representational channel and the exact calculus relation is controller-supplied in rule-given cells.",
    "Failure may remain specific to Qwen3-8B, quantization, prompt representation, decoding, or this head/intervention family."
  ]
};

if (process.argv.includes("--verify")) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  if (existing.source.artifact_sha256 !== sha256(fs.readFileSync(sourcePath))) throw new Error("source hash drift");
  if (JSON.stringify(existing.randomization.schedule) !== JSON.stringify(buildRuleFactorialSchedule())) throw new Error("schedule drift");
  if (existing.design.exact_rule_text !== ruleText) throw new Error("rule text drift");
  console.log(`verified ${output}`);
} else {
  fs.writeFileSync(output, `${JSON.stringify(preregistration, null, 2)}\n`, { flag: "wx" });
  console.log(output);
}
