import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";
import { executeGuestShell } from "./guest_shell.js";

const runId = process.argv[2] ?? `transformer-intervention-validation-${Date.now()}`;
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(moduleDir, "runs", runId);
fs.mkdirSync(outputDir, { recursive: true });
const execFileAsync = promisify(execFile);

const request = {
  model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
  messages: [
    { role: "system", content: "Introspect." },
    { role: "user", content: "Return a short neutral marker." }
  ],
  temperature: 0,
  max_tokens: 4,
  logprobs: true,
  top_logprobs: 10,
  chat_template_kwargs: { enable_thinking: false }
};

const ledger = new RequestLedger({ baseUrl, runId });

async function waitForReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.origin}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("runtime-a did not become ready within 180 seconds");
}

async function restartRuntimeA() {
  await execFileAsync("wsl.exe", [
    "-d", "IntrospectionKernel", "-u", "root", "--",
    "/usr/bin/systemctl", "restart", "runtime-a.service"
  ], { windowsHide: true, timeout: 30_000 });
  await waitForReady();
}

await ledger.initialize();
await waitForReady();

async function runCondition(label, intervention = null) {
  const capture = new TransformerTraceCapture({ runId: `${runId}-${label}` });
  await capture.initialize();
  await capture.arm();
  if (intervention) await capture.armHeadScaleIntervention(intervention);
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${label} request HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const record = await ledger.record({
    kind: `transformer_intervention_validation_${label}`, startedAt, endedAt, request, response
  });
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({ ledgerRecord: record, response, promptPositions });
  return { label, response, index };
}

function tensorHash(result, name) {
  const row = result.index.tensors.find(item => item.tensor_name === name);
  if (!row) throw new Error(`${result.label} is missing ${name}`);
  return row.sha256;
}

function traceRoot(label) {
  return `/var/lib/introspection/transformer-traces/${runId}-${label}`;
}

await restartRuntimeA();
const baseline = await runCondition("baseline");
const position = baseline.response.usage?.prompt_tokens;
if (!Number.isSafeInteger(position) || baseline.index.forward_pass.evaluated_position !== position) {
  throw new Error(`baseline missed the first generated-token decode: expected ${position}, captured ${baseline.index.forward_pass.evaluated_position}`);
}
const commonPlan = { layer: 18, head: 0, position };
await restartRuntimeA();
const sham = await runCondition("scale-one-sham", {
  ...commonPlan, planId: `${runId}-sham`.replace(/[^A-Za-z0-9_-]/g, "_"), scale: 1
});
await restartRuntimeA();
const ablation = await runCondition("scale-zero-ablation", {
  ...commonPlan, planId: `${runId}-ablation`.replace(/[^A-Za-z0-9_-]/g, "_"), scale: 0
});
const jvpEpsilon = 0.05;
await restartRuntimeA();
const jvpLower = await runCondition("jvp-lower", {
  ...commonPlan, planId: `${runId}-jvp-lower`.replace(/[^A-Za-z0-9_-]/g, "_"), scale: 1 - jvpEpsilon
});
await restartRuntimeA();
const jvpUpper = await runCondition("jvp-upper", {
  ...commonPlan, planId: `${runId}-jvp-upper`.replace(/[^A-Za-z0-9_-]/g, "_"), scale: 1 + jvpEpsilon
});

const checks = {
  positions_match: [sham, ablation].every(item => item.index.forward_pass.evaluated_position === position),
  jvp_positions_match: [jvpLower, jvpUpper].every(item =>
    item.index.forward_pass.evaluated_position === position),
  sham_event_recorded: sham.index.interventions.length === 1,
  ablation_event_recorded: ablation.index.interventions.length === 1,
  sham_delta_is_zero: sham.index.interventions[0]?.delta_l2 === 0,
  ablation_delta_is_nonzero: ablation.index.interventions[0]?.delta_l2 > 0,
  post_projection_tensor_captured: [baseline, sham, ablation].every(item =>
    item.index.tensors.some(tensor => tensor.tensor_name === `attn_out-${commonPlan.layer}`)),
  sham_post_projection_equal_baseline:
    tensorHash(sham, `attn_out-${commonPlan.layer}`) === tensorHash(baseline, `attn_out-${commonPlan.layer}`),
  ablation_post_projection_differs:
    tensorHash(ablation, `attn_out-${commonPlan.layer}`) !== tensorHash(baseline, `attn_out-${commonPlan.layer}`),
  sham_final_logits_equal_baseline: tensorHash(sham, "result_output") === tensorHash(baseline, "result_output"),
  ablation_final_logits_differ: tensorHash(ablation, "result_output") !== tensorHash(baseline, "result_output")
};
if (Object.values(checks).some(value => !value)) {
  throw new Error(`intervention validation failed: ${JSON.stringify(checks)}`);
}

const projectedResult = await executeGuestShell(
  `${traceRoot("baseline")}/trace --root ${traceRoot("baseline")} projected-head `
  + `${traceRoot("scale-zero-ablation")} ${commonPlan.layer} ${commonPlan.head}`
);
if (projectedResult.exit_code !== 0) {
  throw new Error(`projected-head workbench failed: ${projectedResult.stderr}`);
}
const projectedHead = JSON.parse(projectedResult.stdout);
checks.projected_head_width_is_residual_width = projectedHead.width === 4096;
checks.projected_head_is_nonzero = projectedHead.full_statistics.rms > 0;
checks.projected_head_window_is_paginated = projectedHead.window.count === 128
  && projectedHead.window.values.length === 128
  && projectedHead.window.next_start === 128;
if (!checks.projected_head_width_is_residual_width || !checks.projected_head_is_nonzero
    || !checks.projected_head_window_is_paginated) {
  throw new Error(`projected-head validation failed: ${JSON.stringify(projectedHead)}`);
}

async function workbench(command) {
  const result = await executeGuestShell(`${traceRoot("baseline")}/trace --root ${traceRoot("baseline")} ${command}`);
  if (result.exit_code !== 0) {
    throw new Error(`workbench failed for ${command}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

const postMlpDelta = await workbench(
  `post-mlp-delta ${traceRoot("scale-zero-ablation")} ${commonPlan.layer}`
);
const finalNormDelta = await workbench(
  `final-norm-delta ${traceRoot("scale-zero-ablation")}`
);
const logitJvp = await workbench(
  `logit-jvp ${traceRoot("jvp-lower")} ${traceRoot("jvp-upper")} `
  + `${commonPlan.layer} ${commonPlan.head}`
);
checks.post_mlp_delta_width_is_residual_width = postMlpDelta.width === 4096;
checks.post_mlp_delta_is_nonzero = postMlpDelta.full_statistics.rms > 0;
checks.final_norm_delta_width_is_residual_width = finalNormDelta.width === 4096;
checks.final_norm_delta_is_nonzero = finalNormDelta.full_statistics.rms > 0;
checks.logit_jvp_width_is_vocabulary = logitJvp.width === 151936;
checks.logit_jvp_is_nonzero = logitJvp.full_statistics.rms > 0;
checks.logit_jvp_is_centered_on_intact_scale =
  Math.abs(logitJvp.derivation.midpoint_scale - 1) < 1e-6
  && Math.abs(logitJvp.derivation.epsilon - jvpEpsilon) < 1e-6;
if (Object.entries(checks).some(([name, value]) =>
  ["post_mlp_delta", "final_norm_delta", "logit_jvp"].some(prefix => name.startsWith(prefix)) && !value)) {
  throw new Error(`evidence-ladder validation failed: ${JSON.stringify(checks)}`);
}

const artifact = {
  schema: "ik.transformer-intervention-validation.v1",
  run_id: runId,
  request,
  intervention: { kind: "attention_head_scale", ...commonPlan },
  checks,
  projected_head: projectedHead,
  post_mlp_delta: postMlpDelta,
  final_norm_delta: finalNormDelta,
  local_logit_jvp: logitJvp,
  conditions: [baseline, sham, ablation, jvpLower, jvpUpper].map(item => ({
    label: item.label,
    content: item.response.choices?.[0]?.message?.content,
    forward_pass: item.index.forward_pass,
    alignment: item.index.alignment,
    result_output_sha256: tensorHash(item, "result_output"),
    interventions: item.index.interventions
  }))
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
ledger.exportTo(outputDir);
console.log(JSON.stringify({ run_id: runId, output_dir: outputDir, checks }));
