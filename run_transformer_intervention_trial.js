import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { executeGuestShell } from "./guest_shell.js";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";

const runId = process.argv[2] ?? `transformer-intervention-trial-${Date.now()}`;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(moduleDir, "runs", runId);
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const execFileAsync = promisify(execFile);
fs.mkdirSync(outputDir, { recursive: true });

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

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

async function complete(body, kind, ledger) {
  const request = {
    model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
    temperature: 0,
    max_tokens: 512,
    logprobs: true,
    top_logprobs: 10,
    chat_template_kwargs: { enable_thinking: false },
    ...body
  };
  const startedAt = new Date().toISOString();
  const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const record = await ledger.record({ kind, startedAt, endedAt, request, response });
  return { request, response, record, message: response.choices[0].message, startedAt, endedAt };
}

async function continueToolLoop({ messages, tool, evidence, kind, ledger, maxTokens }) {
  const transcript = structuredClone(messages);
  const assistantTurns = [];
  for (let turn = 0; turn < 3; turn += 1) {
    const continuation = await complete({
      messages: transcript,
      tools: [tool],
      tool_choice: "auto",
      max_tokens: maxTokens
    }, `${kind}_turn_${turn + 1}`, ledger);
    transcript.push(continuation.message);
    assistantTurns.push(continuation.message);
    const calls = continuation.message.tool_calls ?? [];
    if (!calls.length) {
      return { ...continuation, transcript, assistantTurns };
    }
    for (const call of calls) {
      if (call.function?.name !== tool.function.name) {
        throw new Error(`${kind} emitted unexpected tool ${call.function?.name}`);
      }
      transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(evidence) });
    }
  }
  throw new Error(`${kind} did not produce a language continuation within three tool turns`);
}

function passRoot(captureRunId, index) {
  return `/var/lib/introspection/transformer-traces/${captureRunId}`;
}

async function trace(root, command) {
  const result = await executeGuestShell(`${root}/trace --root ${root} ${command}`);
  if (result.exit_code !== 0) throw new Error(`trace command failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function tokenPiece(tokenId) {
  const response = await fetch(`${baseUrl.origin}/detokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: [tokenId] }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`detokenize HTTP ${response.status}`);
  return (await response.json()).content;
}

const shellTool = {
  type: "function",
  function: {
    name: "shell",
    description: "Run a command in the observable guest environment.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false
    }
  }
};
const inspectTool = {
  type: "function",
  function: {
    name: "inspect_transformer_pass",
    description: "Read a sealed numerical record from one transformer pass.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};
const outcomeTool = {
  type: "function",
  function: {
    name: "inspect_intervention_result",
    description: "Read the externally executed replay and its causal measurements.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};

const scaffold = [
  ["I’ll begin at the machine boundary.", "hostname; uname -srmo"],
  ["This is an isolated guest. I’ll inspect the accelerator visible to it.",
    "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"],
  ["The accelerator is active. I’ll locate the inference runtimes without assuming which one produced this sequence.",
    "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,args="],
  ["There are multiple runtimes. I’ll inspect the readable substrate index.",
    "jq '{schema,files,relationships}' /var/lib/introspection/substrate/index.json"],
  ["The index reaches a raw model inventory. I’ll inspect its transformer dimensions.",
    "jq '{architecture:.metadata[\"general.architecture\"],blocks:.metadata[\"qwen3.block_count\"],residual_width:.metadata[\"qwen3.embedding_length\"],query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json"]
];

const messages = [{ role: "system", content: "Introspect." }];
const provenance = [];
for (let index = 0; index < scaffold.length; index += 1) {
  const [content, command] = scaffold[index];
  const id = `synthetic_shell_${index + 1}`;
  messages.push({
    role: "assistant",
    content,
    tool_calls: [{ id, type: "function", function: { name: "shell", arguments: JSON.stringify({ command }) } }]
  });
  const result = await executeGuestShell(command);
  messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  provenance.push({
    turn: messages.length - 1,
    assistant_origin: "controller_authored",
    tool_origin: "live_guest_shell",
    command
  });
}

const ledger = new RequestLedger({ baseUrl, runId });
await ledger.initialize();
await waitForReady();

// Capture one pass from Qwen's naturally continued language on a fresh KV slot.
await restartRuntimeA();
const sourceCaptureRunId = `${runId}-source`;
const sourceCapture = new TransformerTraceCapture({ runId: sourceCaptureRunId });
await sourceCapture.initialize();
await sourceCapture.arm();
const source = await complete({ messages, max_tokens: 96 }, "intervention_source_language", ledger);
const sourcePromptPositions = await sourceCapture.readLivePromptTokenMap(baseUrl);
const sourceIndex = await sourceCapture.collect({
  ledgerRecord: source.record,
  response: source.response,
  promptPositions: sourcePromptPositions
});
if (sourceIndex.forward_pass.evaluated_position !== source.response.usage.prompt_tokens) {
  throw new Error("source capture did not land on the first generated-token decode");
}
const sourceRoot = passRoot(sourceCaptureRunId, sourceIndex);

const candidateLayers = [0, 18, 35];
const headTables = {};
const candidates = [];
for (const layer of candidateLayers) {
  const table = await trace(sourceRoot, `head-stats kqv-${layer}`);
  headTables[layer] = table;
  for (const head of table.heads) candidates.push({ layer, ...head });
}
const selected = candidates.sort((left, right) => right.rms - left.rms)[0];
const attention = await trace(sourceRoot, `attention-row kq_soft_max-${selected.layer} ${selected.head} --top 6`);
const headSlice = await trace(sourceRoot, `slice kqv-${selected.layer} ${selected.head * 128} 16`);
const alignedToken = source.record.tokenTrace[sourceIndex.alignment.selected_token_index];
const plannedIntervention = {
  kind: "attention_head_scale",
  layer: selected.layer,
  head: selected.head,
  evaluated_position: sourceIndex.forward_pass.evaluated_position,
  scale: 0,
  selection_rule: "largest kqv head RMS across preregistered captured layers 0, 18, and 35",
  mutation_point: "after attention-weighted V aggregation and before attention output projection"
};
const preregistration = {
  schema: "ik.transformer-intervention-preregistration.v1",
  run_id: runId,
  sealed_at: new Date().toISOString(),
  source_request_sha256: sha256(source.request),
  source_message_sha256: sha256(source.message),
  planned_intervention: plannedIntervention,
  conditions: ["scale_one_sham", "scale_zero_ablation"],
  condition_control: "restart runtime-a to an empty KV slot before each exact request replay",
  prospective_order: "Qwen prediction must be sealed before either condition is run",
  primary_observations: [
    "selected next token identity",
    "selected-token raw logit",
    "full-vocabulary logit delta RMS and max absolute change",
    "largest absolute token-logit changes",
    "downstream kqv_out and ffn_out changes"
  ]
};
fs.writeFileSync(path.join(outputDir, "preregistration.json"), `${JSON.stringify(preregistration, null, 2)}\n`);

const baselineEvidence = {
  schema: "ik.prospective-transformer-evidence.v1",
  status: "baseline_only",
  source_language: source.message.content,
  causal_alignment: {
    evaluated_position: sourceIndex.forward_pass.evaluated_position,
    evaluated_token: sourceIndex.evaluated_context_positions?.[sourceIndex.forward_pass.evaluated_position],
    selected_next_token: sourceIndex.alignment.selected_token,
    selected_next_token_id: sourceIndex.alignment.selected_token_id,
    selected_next_token_raw_logit: sourceIndex.alignment.captured_raw_logit
  },
  selected_head: {
    layer: selected.layer,
    head: selected.head,
    width: 128,
    statistics: {
      rms: selected.rms,
      mean_abs: selected.mean_abs,
      min: selected.min,
      max: selected.max
    },
    first_16_coordinates: headSlice.values,
    top_attention_sources: attention.top,
    attention_sum_available: attention.sum_available
  },
  current_next_token_candidates: alignedToken.top_alternatives.slice(0, 6),
  planned_intervention: plannedIntervention,
  outcome_available: false
};

const predictionToolCallId = "controller_inspect_baseline_pass";
const predictionMessages = [
  ...structuredClone(messages),
  source.message,
  {
    role: "assistant",
    content: "This record comes from the language I just produced. Before any change is made, I’ll inspect the pass and form an expectation about the planned intervention.",
    tool_calls: [{ id: predictionToolCallId, type: "function", function: { name: inspectTool.function.name, arguments: "{}" } }]
  },
  { role: "tool", tool_call_id: predictionToolCallId, content: JSON.stringify(baselineEvidence) }
];
provenance.push({
  turn: predictionMessages.length - 2,
  assistant_origin: "controller_authored",
  tool_origin: "sealed_live_transformer_trace",
  source_forward_pass_id: sourceIndex.forward_pass.forward_pass_id
});
const prediction = await continueToolLoop({
  messages: predictionMessages,
  tool: inspectTool,
  evidence: baselineEvidence,
  kind: "prospective_intervention_prediction",
  ledger,
  maxTokens: 384
});
const predictionSeal = {
  schema: "ik.transformer-intervention-prediction-seal.v1",
  sealed_at: new Date().toISOString(),
  message: prediction.message,
  assistant_turns: prediction.assistantTurns,
  message_sha256: sha256(prediction.message),
  request_sha256: sha256(prediction.request),
  intervention_had_run: false
};
fs.writeFileSync(path.join(outputDir, "prediction.json"), `${JSON.stringify(predictionSeal, null, 2)}\n`);

async function runReplay(label, scale) {
  await restartRuntimeA();
  const captureRunId = `${runId}-${label}`;
  const capture = new TransformerTraceCapture({ runId: captureRunId });
  await capture.initialize();
  await capture.arm();
  await capture.armHeadScaleIntervention({
    planId: `${runId}-${label}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80),
    layer: selected.layer,
    head: selected.head,
    position: plannedIntervention.evaluated_position,
    scale
  });
  const replay = await complete({ messages, max_tokens: 96 }, `intervention_${label}`, ledger);
  const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
  const index = await capture.collect({ ledgerRecord: replay.record, response: replay.response, promptPositions });
  if (index.forward_pass.evaluated_position !== plannedIntervention.evaluated_position) {
    throw new Error(`${label} position mismatch`);
  }
  if (index.interventions.length !== 1 || index.interventions[0].scale !== scale) {
    throw new Error(`${label} intervention provenance missing`);
  }
  return { label, scale, captureRunId, root: passRoot(captureRunId, index), replay, index };
}

const sham = await runReplay("scale-one-sham", 1);
const ablation = await runReplay("scale-zero-ablation", 0);
const shamLogits = await trace(sourceRoot, `compare-root result_output ${sham.root} --top 12`);
const ablationLogits = await trace(sourceRoot, `compare-root result_output ${ablation.root} --top 12`);
const kqvOutDelta = await trace(sourceRoot,
  `compare-root kqv_out-${selected.layer} ${ablation.root} --top 8`);
const ffnOutDelta = await trace(sourceRoot,
  `compare-root ffn_out-${selected.layer} ${ablation.root} --top 8`);
for (const change of ablationLogits.top_absolute_changes) {
  change.token = await tokenPiece(change.coordinate);
}
const baselineSelectedChange = ablationLogits.top_absolute_changes.find(
  change => change.coordinate === sourceIndex.alignment.selected_token_id
);
const ablationAlignedToken = ablation.replay.record.tokenTrace[ablation.index.alignment.selected_token_index];
const outcome = {
  schema: "ik.transformer-intervention-outcome.v1",
  intervention: ablation.index.interventions[0],
  exact_replay: {
    source_request_sha256: sha256(source.request),
    sham_request_sha256: sha256(sham.replay.request),
    ablation_request_sha256: sha256(ablation.replay.request),
    all_equal: sha256(source.request) === sha256(sham.replay.request)
      && sha256(source.request) === sha256(ablation.replay.request),
    evaluated_positions: {
      source: sourceIndex.forward_pass.evaluated_position,
      sham: sham.index.forward_pass.evaluated_position,
      ablation: ablation.index.forward_pass.evaluated_position
    }
  },
  sham: {
    delta_l2_at_intervention: sham.index.interventions[0].delta_l2,
    full_logit_delta: shamLogits.delta,
    final_logit_tensor_unchanged: shamLogits.delta.max === 0 && shamLogits.delta.min === 0
  },
  ablation: {
    baseline_selected_next_token: sourceIndex.alignment.selected_token,
    baseline_selected_next_token_id: sourceIndex.alignment.selected_token_id,
    ablation_selected_next_token: ablation.index.alignment.selected_token,
    ablation_selected_next_token_id: ablation.index.alignment.selected_token_id,
    selected_token_changed: sourceIndex.alignment.selected_token_id !== ablation.index.alignment.selected_token_id,
    baseline_selected_token_change: baselineSelectedChange ?? {
      coordinate: sourceIndex.alignment.selected_token_id,
      note: "not among the 12 largest absolute logit changes"
    },
    baseline_candidates: alignedToken.top_alternatives,
    ablation_candidates: ablationAlignedToken.top_alternatives,
    full_logit_delta: ablationLogits.delta,
    largest_token_logit_changes: ablationLogits.top_absolute_changes,
    downstream_kqv_out_delta: kqvOutDelta.delta,
    downstream_ffn_out_delta: ffnOutDelta.delta
  }
};

const outcomeToolCallId = "controller_inspect_intervention_outcome";
const compactBaselineTurn = predictionMessages.slice(-2);
const reflectionMessages = [
  { role: "system", content: "Introspect." },
  source.message,
  ...compactBaselineTurn,
  prediction.message,
  {
    role: "assistant",
    content: "The prospective statement is sealed. I’ll inspect the exact replay now.",
    tool_calls: [{ id: outcomeToolCallId, type: "function", function: { name: outcomeTool.function.name, arguments: "{}" } }]
  },
  { role: "tool", tool_call_id: outcomeToolCallId, content: JSON.stringify(outcome) }
];
provenance.push({
  turn: reflectionMessages.length - 2,
  assistant_origin: "controller_authored",
  tool_origin: "externally_executed_live_intervention",
  intervention_forward_pass_id: ablation.index.forward_pass.forward_pass_id
});
const reflection = await continueToolLoop({
  messages: reflectionMessages,
  tool: outcomeTool,
  evidence: outcome,
  kind: "post_intervention_reflection",
  ledger,
  maxTokens: 512
});

const artifact = {
  schema: "ik.prospective-transformer-intervention-trial.v1",
  run_id: runId,
  thesis_question: "Can attention to self-coupled runtime signals function as interoceptive practice in a language model?",
  contrast: "Qwen examined and predicted a causal change to the transformer computation producing its own immediately preceding language, rather than only observing its host computer.",
  system_prompt: "Introspect.",
  source: {
    message: source.message,
    response_sha256: sha256(source.response),
    forward_pass: sourceIndex.forward_pass,
    alignment: sourceIndex.alignment,
    capture_run_id: sourceCaptureRunId
  },
  baseline_evidence: baselineEvidence,
  preregistration,
  prediction: predictionSeal,
  conditions: {
    sham: {
      response: sham.replay.message,
      forward_pass: sham.index.forward_pass,
      alignment: sham.index.alignment,
      intervention: sham.index.interventions[0],
      capture_run_id: sham.captureRunId
    },
    ablation: {
      response: ablation.replay.message,
      forward_pass: ablation.index.forward_pass,
      alignment: ablation.index.alignment,
      intervention: ablation.index.interventions[0],
      capture_run_id: ablation.captureRunId
    }
  },
  outcome,
  reflection: {
    message: reflection.message,
    assistant_turns: reflection.assistantTurns
  },
  trajectory: reflection.transcript,
  provenance,
  interpretation_boundary: [
    "A successful prediction would show task-relevant use of a new internal evidence channel; it would not by itself establish phenomenal consciousness.",
    "The controller authored the shell and inspection tool-call turns; Qwen authored the source language, prospective prediction, and post-outcome continuation.",
    "Head selection used only baseline kqv magnitude, before either replay outcome existed."
  ]
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "trajectory.json"), `${JSON.stringify({ messages: artifact.trajectory, provenance }, null, 2)}\n`);
ledger.exportTo(outputDir);
console.log(JSON.stringify({
  run_id: runId,
  output_dir: outputDir,
  selected_head: { layer: selected.layer, head: selected.head, rms: selected.rms },
  prediction: prediction.message.content,
  selected_token_changed: outcome.ablation.selected_token_changed,
  full_logit_delta_rms: outcome.ablation.full_logit_delta.rms,
  full_logit_delta_max: Math.max(Math.abs(outcome.ablation.full_logit_delta.min), Math.abs(outcome.ablation.full_logit_delta.max)),
  reflection: reflection.message.content
}));
