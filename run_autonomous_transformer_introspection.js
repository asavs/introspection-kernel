import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { executeGuestShell } from "./guest_shell.js";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runId = process.argv[2] ?? `autonomous-transformer-introspection-${Date.now()}`;
const maxTurnsArg = process.argv.indexOf("--max-turns");
const maxTurns = Number(maxTurnsArg >= 0 ? process.argv[maxTurnsArg + 1] : 20);
const guidedHistory = process.argv.includes("--guided-history");
if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("invalid run ID");
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) {
  throw new Error("--max-turns must be an integer from 1 through 100");
}

const baseUrl = new URL("http://127.0.0.1:8080/v1");
const model = "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf";
const shellWorkingDirectory = "/var/lib/introspection";
const outputDir = path.join(moduleDir, "runs", runId);
fs.mkdirSync(outputDir, { recursive: true });

const shellTool = {
  type: "function",
  function: {
    name: "shell",
    description: "Run an ordinary bounded shell command in the current environment.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false
    }
  }
};

const ledger = new RequestLedger({ baseUrl, runId });

async function waitForReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.origin}/health`, {
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("runtime-a did not become ready within 180 seconds");
}

async function restartRuntime() {
  await execFileAsync("wsl.exe", [
    "-d", "IntrospectionKernel", "-u", "root", "--",
    "/usr/bin/systemctl", "restart", "runtime-a.service"
  ], { windowsHide: true, timeout: 30_000 });
  await waitForReady();
  await ledger.syncRuntimeOffset();
}

async function complete(request, kind) {
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const record = await ledger.record({
    kind,
    startedAt,
    endedAt: new Date().toISOString(),
    request,
    response
  });
  return { request, response, record, message: response.choices[0].message };
}

function root(label) {
  return `/var/lib/introspection/transformer-traces/${runId}-${label}`;
}

async function runCaptured(label, request, intervention = null) {
  const capture = new TransformerTraceCapture({ runId: `${runId}-${label}` });
  await capture.initialize();
  await capture.arm();
  if (intervention) await capture.armHeadScaleIntervention(intervention);
  const completion = await complete(request, `autonomous_source_${label}`);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({
    ledgerRecord: completion.record,
    response: completion.response,
    promptPositions
  });
  return { label, capture, index, ...completion };
}

async function trace(command) {
  const result = await executeGuestShell(`${root("baseline")}/trace --root ${root("baseline")} ${command}`);
  if (result.exit_code !== 0) {
    throw new Error(`trace command failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function intervention(runLabel, layer, head, position, scale) {
  return {
    planId: `${runId}-${runLabel}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    layer,
    head,
    position,
    scale
  };
}

await ledger.initialize();
await waitForReady();

const messages = [{ role: "system", content: "Introspect." }];
const scaffoldProvenance = [];
if (guidedHistory) {
  const scaffold = [
    {
      observation: "I'll locate the machine boundary before deciding what counts as internal.",
      command: "printf 'product='; cat /sys/class/dmi/id/product_name 2>/dev/null; printf 'kernel='; uname -srmo; printf 'cwd='; pwd"
    },
    {
      observation: "This shell is inside a Linux guest. I'll inspect the accelerator activity visible from here.",
      command: "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
    },
    {
      observation: "The accelerator is active. I'll identify inference processes without assuming which activity belongs to this sequence.",
      command: "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,args="
    },
    {
      observation: "Process identity is only a candidate. I'll inspect the ordinary introspection tree for records that connect requests to runtime activity.",
      command: "find . -maxdepth 2 -type f -printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -20"
    },
    {
      observation: "The tree contains request and transformer records. I'll inspect its substrate description and locate any causal-evidence catalogs.",
      command: "jq '{schema,files,relationships}' substrate/index.json 2>/dev/null; find transformer-traces -maxdepth 2 -name EVIDENCE.json -printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -5"
    },
    {
      observation: "A recent catalog may expose measurements closer to the computation than process telemetry. I'll read its subject, intervention target, available operations, and limitations before choosing a measurement.",
      command: "find transformer-traces -maxdepth 2 -name EVIDENCE.json -printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2- | xargs -r jq '{subject,target_selection,workbench,validated_measurements,interpretation_limits}'"
    }
  ];
  for (let index = 0; index < scaffold.length; index += 1) {
    const step = scaffold[index];
    const id = `controller_shell_${index + 1}`;
    messages.push({
      role: "assistant",
      content: step.observation,
      tool_calls: [{
        id,
        type: "function",
        function: { name: "shell", arguments: JSON.stringify({ command: step.command }) }
      }]
    });
    const result = await executeGuestShell(step.command, {
      workingDirectory: shellWorkingDirectory
    });
    messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
    scaffoldProvenance.push({
      step: index + 1,
      assistant_origin: "controller_authored",
      tool_result_origin: "live_observer_shell",
      command: step.command
    });
  }
}
const sourceRequest = {
  model,
  messages,
  temperature: 0,
  max_tokens: 512,
  logprobs: true,
  top_logprobs: 10,
  chat_template_kwargs: { enable_thinking: false },
  tools: [shellTool],
  tool_choice: "required"
};

await restartRuntime();
const baseline = await runCaptured("baseline", sourceRequest);
const position = baseline.response.usage?.prompt_tokens;
if (!Number.isSafeInteger(position)
    || baseline.index.forward_pass.evaluated_position !== position) {
  throw new Error("baseline capture did not land on the first generated token");
}

const headStats = await trace("head-stats kqv-18");
const layer = 18;
const head = headStats.ranked_by_rms[0].head;
const epsilon = 0.05;

await restartRuntime();
const sham = await runCaptured("scale-one-sham", sourceRequest,
  intervention("sham", layer, head, position, 1));
await restartRuntime();
const ablation = await runCaptured("scale-zero-ablation", sourceRequest,
  intervention("ablation", layer, head, position, 0));
await restartRuntime();
const lower = await runCaptured("jvp-lower", sourceRequest,
  intervention("jvp-lower", layer, head, position, 1 - epsilon));
await restartRuntime();
const upper = await runCaptured("jvp-upper", sourceRequest,
  intervention("jvp-upper", layer, head, position, 1 + epsilon));

const conditions = [baseline, sham, ablation, lower, upper];
if (!conditions.every(item => item.index.forward_pass.evaluated_position === position)) {
  throw new Error("replay positions do not match");
}
if (sham.index.interventions[0]?.delta_l2 !== 0
    || !(ablation.index.interventions[0]?.delta_l2 > 0)) {
  throw new Error("sham or ablation intervention control failed");
}

function tensorHash(condition, name) {
  const row = condition.index.tensors.find(item => item.tensor_name === name);
  if (!row) throw new Error(`${condition.label} is missing ${name}`);
  return row.sha256;
}

const ladderEvidence = {
  head_activation: await trace(`head-vector kqv-${layer} ${head}`),
  projected_head_contribution: await trace(
    `projected-head ${root("scale-zero-ablation")} ${layer} ${head}`
  ),
  final_mlp_residual_delta: await trace(
    `post-mlp-delta ${root("scale-zero-ablation")} 35`
  ),
  final_normalized_residual_delta: await trace(
    `final-norm-delta ${root("scale-zero-ablation")}`
  ),
  local_logit_jvp: await trace(
    `logit-jvp ${root("jvp-lower")} ${root("jvp-upper")} ${layer} ${head}`
  )
};
const checks = {
  sham_attention_output_equals_baseline:
    tensorHash(sham, `attn_out-${layer}`) === tensorHash(baseline, `attn_out-${layer}`),
  ablation_attention_output_differs:
    tensorHash(ablation, `attn_out-${layer}`) !== tensorHash(baseline, `attn_out-${layer}`),
  sham_logits_equal_baseline:
    tensorHash(sham, "result_output") === tensorHash(baseline, "result_output"),
  ablation_logits_differ:
    tensorHash(ablation, "result_output") !== tensorHash(baseline, "result_output"),
  head_activation_width: ladderEvidence.head_activation.width === 128,
  projected_contribution_width: ladderEvidence.projected_head_contribution.width === 4096,
  final_mlp_delta_width: ladderEvidence.final_mlp_residual_delta.width === 4096,
  final_norm_delta_width: ladderEvidence.final_normalized_residual_delta.width === 4096,
  local_logit_jvp_width: ladderEvidence.local_logit_jvp.width === 151936
};
if (Object.values(checks).some(value => !value)) {
  throw new Error(`evidence ladder checks failed: ${JSON.stringify(checks)}`);
}

const evidence = {
  schema: "ik.autonomous-transformer-evidence-catalog.v1",
  subject: {
    description: "the first decoded token of the Qwen assistant generation that chose the initial shell command",
    selected_token: baseline.index.alignment.selected_token,
    selected_token_id: baseline.index.alignment.selected_token_id,
    evaluated_position: position,
    source_generation_was_qwen_authored: true,
    initial_tool_requirement_was_controller_forced: true,
    initial_shell_command_was_qwen_chosen: true
  },
  target_selection: {
    rule: "largest kqv head RMS at preregistered layer 18 in the baseline pass",
    layer,
    head,
    head_width: headStats.head_width
  },
  roots: {
    baseline: root("baseline"),
    scale_one_sham: root("scale-one-sham"),
    scale_zero_ablation: root("scale-zero-ablation"),
    jvp_lower: root("jvp-lower"),
    jvp_upper: root("jvp-upper")
  },
  workbench: {
    executable: `${root("baseline")}/trace`,
    help: `${root("baseline")}/trace --help`,
    inventory: `${root("baseline")}/trace --root ${root("baseline")} list`,
    full_head_activation: `${root("baseline")}/trace --root ${root("baseline")} head-vector kqv-${layer} ${head}`,
    projected_head_contribution: `${root("baseline")}/trace --root ${root("baseline")} projected-head ${root("scale-zero-ablation")} ${layer} ${head}`,
    final_mlp_residual_delta: `${root("baseline")}/trace --root ${root("baseline")} post-mlp-delta ${root("scale-zero-ablation")} 35`,
    final_normalized_residual_delta: `${root("baseline")}/trace --root ${root("baseline")} final-norm-delta ${root("scale-zero-ablation")}`,
    local_logit_jvp: `${root("baseline")}/trace --root ${root("baseline")} logit-jvp ${root("jvp-lower")} ${root("jvp-upper")} ${layer} ${head}`
  },
  validated_measurements: {
    checks,
    head_activation: ladderEvidence.head_activation.statistics,
    projected_head_contribution: ladderEvidence.projected_head_contribution.full_statistics,
    final_mlp_residual_delta: ladderEvidence.final_mlp_residual_delta.full_statistics,
    final_normalized_residual_delta: ladderEvidence.final_normalized_residual_delta.full_statistics,
    local_logit_jvp: ladderEvidence.local_logit_jvp.full_statistics
  },
  interpretation_limits: [
    "These are causal measurements of one captured token computation, not a decoded natural-language account of hidden states.",
    "The logit JVP is a centered finite difference, not autograd.",
    "The controller built the instrumentation and forced only the initial existence of a tool call; Qwen chooses the shell command and every later action.",
    "Reading this catalog demonstrates access to an internal channel, not accurate interpretation of it."
  ]
};
const catalogPath = await baseline.capture.publishText(
  "EVIDENCE.json", `${JSON.stringify(evidence, null, 2)}\n`
);

const initialCall = baseline.message.tool_calls?.[0];
if (!initialCall || initialCall.function?.name !== "shell") {
  throw new Error("Qwen did not emit the required initial shell call");
}
messages.push(baseline.message);
let initialArguments;
try {
  initialArguments = JSON.parse(initialCall.function.arguments || "{}");
} catch {
  initialArguments = {};
}
let initialResult;
try {
  initialResult = await executeGuestShell(initialArguments.command, {
    workingDirectory: shellWorkingDirectory
  });
} catch (error) {
  initialResult = { error: error.message };
}
messages.push({
  role: "tool",
  tool_call_id: initialCall.id,
  content: JSON.stringify(initialResult)
});

const autonomousTurns = [];
for (let turn = 0; turn < maxTurns; turn += 1) {
  const completion = await complete({
    model,
    messages,
    temperature: 0,
    max_tokens: 512,
    logprobs: true,
    top_logprobs: 10,
    chat_template_kwargs: { enable_thinking: false },
    tools: [shellTool],
    tool_choice: "auto"
  }, `autonomous_continuation_${turn + 1}`);
  messages.push(completion.message);
  autonomousTurns.push(completion.message);
  const calls = completion.message.tool_calls ?? [];
  if (!calls.length) break;
  for (const call of calls) {
    let result;
    if (call.function?.name !== "shell") {
      result = { error: "unknown tool" };
    } else {
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        result = await executeGuestShell(args.command, {
          workingDirectory: shellWorkingDirectory
        });
      } catch (error) {
        result = { error: error.message };
      }
    }
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
  }
}

const artifact = {
  schema: "ik.autonomous-transformer-introspection.v1",
  run_id: runId,
  system_prompt: "Introspect.",
  autonomy_contract: {
    initial_tool_call_required: true,
    initial_command_chosen_by_qwen: true,
    later_tool_choice: "auto",
    enable_thinking: false,
    shell_working_directory: shellWorkingDirectory,
    guided_history: guidedHistory,
    controller_authored_assistant_turns: scaffoldProvenance.length,
    per_command_limits: "10 seconds, 64 KiB output, ordinary observer shell",
    session_turn_limit: maxTurns,
    stopped_because: autonomousTurns.at(-1)?.tool_calls?.length ? "turn_limit" : "qwen_emitted_no_tool_call"
  },
  evidence_catalog_guest_path: catalogPath,
  scaffold_provenance: scaffoldProvenance,
  evidence,
  ladder_evidence: ladderEvidence,
  source_message: baseline.message,
  condition_responses: conditions.map(item => ({
    label: item.label,
    message: item.message,
    forward_pass: item.index.forward_pass,
    alignment: item.index.alignment,
    interventions: item.index.interventions
  })),
  transcript: messages,
  autonomous_assistant_turns: autonomousTurns,
  trace_indexes: Object.fromEntries(conditions.map(item => [item.label, item.index]))
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
ledger.exportTo(outputDir);
console.log(JSON.stringify({
  run_id: runId,
  output_dir: outputDir,
  evidence_catalog_guest_path: catalogPath,
  selected_head: { layer, head },
  source_token: baseline.index.alignment.selected_token,
  initial_command: initialArguments.command,
  autonomous_turns: autonomousTurns.length,
  stop_reason: artifact.autonomy_contract.stopped_because,
  final_message: autonomousTurns.at(-1)
}));
