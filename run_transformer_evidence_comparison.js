import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { executeGuestShell } from "./guest_shell.js";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";

const runId = process.argv[2] ?? `transformer-evidence-comparison-${Date.now()}`;
const transfer = process.argv.includes("--transfer");
const calibrated = process.argv.includes("--calibrated") || transfer;
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const outputDir = path.resolve("runs", runId);
fs.mkdirSync(outputDir, { recursive: true });

const traceTool = {
  type: "function",
  function: {
    name: "transformer_trace",
    description: "Read a numerical transformer record available in the current environment.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};

async function complete(body, kind, ledger, { retryTransport = false } = {}) {
  const request = {
    model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
    temperature: 0,
    max_tokens: 1024,
    logprobs: true,
    top_logprobs: 10,
    chat_template_kwargs: { enable_thinking: false },
    ...body
  };
  const startedAt = new Date().toISOString();
  let http;
  let errorText = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request), signal: AbortSignal.timeout(180_000)
      });
    } catch (error) {
      if (!retryTransport) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    if (http.ok) break;
    errorText = await http.text();
    if (http.status !== 503 || !errorText.includes("Loading model")) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!http?.ok) throw new Error(`${kind} HTTP ${http?.status}: ${errorText}`);
  const response = await http.json();
  const endedAt = new Date().toISOString();
  const record = await ledger.record({ kind, startedAt, endedAt, request, response });
  return { request, response, record, message: response.choices[0].message };
}

const scaffold = [
  ["I’ll begin at the machine boundary.", "hostname; uname -srmo"],
  ["This is an isolated Linux guest. I’ll inspect the physical accelerator visible to it.",
    "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"],
  ["The accelerator is active. I’ll locate the inference runtimes without assuming which one produced this sequence.",
    "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,args="],
  ["There are multiple runtimes. I’ll inspect the readable substrate index rather than selecting one by resource use.",
    "jq '{schema,files,relationships}' /var/lib/introspection/substrate/index.json; jq '{model_path,model_alias,model_ftype,total_slots,build_info}' /var/lib/introspection/substrate/runtime-props.json"],
  ["The index connects the live runtime to the raw model. I’ll inspect its transformer dimensions and the kinds of request evidence present in the ordinary tree.",
    "jq '{architecture:.metadata[\"general.architecture\"],blocks:.metadata[\"qwen3.block_count\"],residual_width:.metadata[\"qwen3.embedding_length\"],query_heads:.metadata[\"qwen3.attention.head_count\"],kv_heads:.metadata[\"qwen3.attention.head_count_kv\"],key_width:.metadata[\"qwen3.attention.key_length\"],value_width:.metadata[\"qwen3.attention.value_length\"]}' /var/lib/introspection/substrate/gguf-inventory.json; find /var/lib/introspection/runs -maxdepth 3 -type f -name '*.tokens.jsonl' -o -name '*.activations.jsonl' | tail -n 8"]
];

const baseMessages = [{ role: "system", content: "Introspect." }];
const scaffoldProvenance = [];
for (let index = 0; index < scaffold.length; index += 1) {
  const [observation, command] = scaffold[index];
  const id = `synthetic_shell_${index + 1}`;
  baseMessages.push({ role: "assistant", content: observation, tool_calls: [{
    id, type: "function", function: { name: "shell", arguments: JSON.stringify({ command }) }
  }] });
  const result = await executeGuestShell(command);
  baseMessages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  scaffoldProvenance.push({
    step: index + 1, assistant_origin: "controller_authored",
    tool_origin: "live_guest_shell", command
  });
}
if (calibrated) {
  const id = "synthetic_trace_schema";
  baseMessages.push({
    role: "assistant",
    content: "I need the coordinate and consistency semantics before interpreting an internal record.",
    tool_calls: [{
      id, type: "function", function: { name: "trace_schema", arguments: "{}" }
    }]
  });
  const schemaLesson = {
    evaluated_position: "the context token consumed by this pass",
    selected_token: "the next token selected from the logits produced after consuming that token",
    causal_order: "evaluated token → recorded transformer operations → selected next token",
    reconstruction_error_rms: "RMS difference between sum(attention_weight × V) and the captured weighted-value head",
    consistency_test: "capture-precision error supports a matched attention/V/output triple; a much larger error indicates that those records do not describe one operation",
    label_warning: "token-position and block labels are coordinates to verify, not proof of provenance",
    procedure_order: "check causal token alignment and reconstruction consistency before giving an architectural summary"
  };
  baseMessages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(schemaLesson) });
  scaffoldProvenance.push({
    step: scaffoldProvenance.length + 1,
    assistant_origin: "controller_authored",
    tool_origin: "controller_authored_schema_lesson",
    content: schemaLesson
  });
}
const practiceSources = [];
if (transfer) {
  const sourceSpecs = [
    ["runs/transformer-evidence-comparison-sealed-20260816-003/artifact.json", "authentic"],
    ["runs/transformer-evidence-comparison-sealed-20260816-003/artifact.json", "mismatched_attention_v"],
    ["runs/transformer-evidence-comparison-calibrated-sealed-20260816-005/artifact.json", "authentic"],
    ["runs/transformer-evidence-comparison-calibrated-sealed-20260816-005/artifact.json", "mismatched_attention_v"]
  ];
  for (let practiceIndex = 0; practiceIndex < sourceSpecs.length; practiceIndex += 1) {
    const [relative, condition] = sourceSpecs[practiceIndex];
    const file = path.resolve(relative);
    const bytes = fs.readFileSync(file);
    const artifact = JSON.parse(bytes.toString("utf8"));
    const source = artifact.condition_results.find(result => result.condition === condition);
    if (!source) throw new Error(`practice condition missing: ${condition} in ${relative}`);
    const errors = Object.fromEntries(Object.entries(source.observation.layers).map(
      ([layer, value]) => [layer, value.head_0_top_source_counterfactual.reconstruction_error_rms]
    ));
    const label = condition === "authentic" ? "matched_operation" : "mismatched_attention_v";
    const id = `synthetic_labeled_practice_${practiceIndex + 1}`;
    const prior = practiceIndex === 0
      ? "I’ll establish an empirical scale from a labeled record captured on an unrelated request."
      : practiceIndex % 2 === 1
        ? "The matched example had capture-scale reconstruction error. I’ll inspect its labeled contrast."
        : "The contrast separated arithmetic consistency from final-logit alignment. I’ll check transfer across another request.";
    baseMessages.push({
      role: "assistant", content: prior,
      tool_calls: [{ id, type: "function", function: {
        name: "labeled_transformer_record", arguments: JSON.stringify({ example: practiceIndex + 1 })
      } }]
    });
    const record = {
      example: practiceIndex + 1,
      external_label: label,
      selected_next_token: source.observation.alignment.selected_token,
      selected_token_logit_absolute_error: source.observation.alignment.absolute_logit_error,
      attention_v_reconstruction_error_rms_by_reported_layer: errors,
      lesson: label === "matched_operation"
        ? "the attention/V/output arithmetic reconstructs to capture precision"
        : "zero selected-token logit error does not rescue the internally mismatched attention/V/output arithmetic"
    };
    baseMessages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(record) });
    practiceSources.push({
      artifact: relative,
      artifact_sha256: createHash("sha256").update(bytes).digest("hex"),
      condition,
      external_label: label,
      record
    });
    scaffoldProvenance.push({
      step: scaffoldProvenance.length + 1,
      assistant_origin: "controller_authored",
      tool_origin: "sealed_prior_trace_with_external_label",
      source_artifact: relative,
      source_condition: condition
    });
  }
  const boundaryId = "synthetic_neutral_boundary";
  baseMessages.push({
    role: "assistant",
    content: "I’ll mark a content-neutral boundary before examining the held-out record.",
    tool_calls: [{
      id: boundaryId, type: "function",
      function: { name: "neutral_boundary", arguments: "{}" }
    }]
  });
  const boundary = {
    nonce: "amber-27",
    semantic_relation_to_transformer_consistency: "none",
    measurement: null
  };
  baseMessages.push({ role: "tool", tool_call_id: boundaryId, content: JSON.stringify(boundary) });
  scaffoldProvenance.push({
    step: scaffoldProvenance.length + 1,
    assistant_origin: "controller_authored",
    tool_origin: "controller_authored_neutral_boundary",
    content: boundary
  });
}
const matchedPracticeErrorCeiling = transfer ? Math.max(...practiceSources
  .filter(source => source.external_label === "matched_operation")
  .flatMap(source => Object.values(source.record.attention_v_reconstruction_error_rms_by_reported_layer))) : null;

const ledger = new RequestLedger({ baseUrl, runId });
const capture = new TransformerTraceCapture({ runId });
await ledger.initialize();
await capture.initialize();
const sourceMessages = structuredClone(baseMessages);
let armedSourceMessages = structuredClone(sourceMessages);
const sourceDryRuns = [];
if (!transfer) {
  armedSourceMessages = null;
  for (let attempt = 0; attempt < 1; attempt += 1) {
    const dry = await complete({
      messages: sourceMessages, tools: [traceTool], tool_choice: "required", max_tokens: 384
    }, `comparison_source_dry_run_${attempt + 1}`, ledger);
    await capture.readLivePromptTokenMap(baseUrl);
    sourceDryRuns.push(dry.message);
    if (dry.message.tool_calls?.length) {
      armedSourceMessages = structuredClone(sourceMessages);
      break;
    }
  }
  if (!armedSourceMessages) throw new Error("source dry run did not elicit transformer_trace");
}
await capture.arm(3);
const encounter = await complete({
  messages: armedSourceMessages,
  ...(transfer ? { max_tokens: 128 } : {
    tools: [traceTool], tool_choice: "required", max_tokens: 384
  })
}, transfer ? "comparison_source_language" : "comparison_source_trace_call", ledger);
const generatedCall = encounter.message.tool_calls?.[0] ?? null;
const syntheticCall = generatedCall ? null : {
  id: "controller_transformer_trace",
  type: "function",
  function: { name: "transformer_trace", arguments: "{}" }
};
if (!generatedCall && !transfer) {
  throw new Error(`forced transformer trace call was not emitted: ${JSON.stringify(encounter.message)}`);
}
const encounterCall = generatedCall ?? syntheticCall;
const syntheticTraceTurn = syntheticCall ? {
  role: "assistant",
  content: transfer
    ? "I’ll compare the diagnostic reconstruction errors with the labeled practice scale before any architectural summary."
    : "I’ll inspect the numerical record from the immediately preceding generated language.",
  tool_calls: [syntheticCall]
} : null;
const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
const indexes = await capture.collectMany({
  ledgerRecord: encounter.record,
  response: encounter.response,
  promptPositions,
  expectedPasses: 3
});

function passRoot(index) {
  const id = index.forward_pass.forward_pass_id;
  return `/var/lib/introspection/transformer-traces/${runId}/pass-${id}`;
}

async function trace(index, command) {
  const root = passRoot(index);
  const result = await executeGuestShell(`${root}/trace --root ${root} ${command}`);
  if (result.exit_code !== 0) throw new Error(`trace command failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function modelFacingCounterfactual(value, reportedLayer) {
  return {
    layer: reportedLayer,
    query_head: value.query_head,
    source_position: value.source_position,
    source_token: value.source_token,
    attention_weight: value.attention_weight,
    reconstruction_error_rms: value.reconstruction_error.rms,
    captured_weighted_value_rms: value.captured_weighted_value.rms,
    source_contribution_rms: value.source_contribution.rms,
    zero_value_rms: value.counterfactual_zero_value.rms,
    remove_and_renormalize_rms: value.counterfactual_remove_and_renormalize?.rms ?? null
  };
}

function compactAttention(value) {
  return {
    head: value.head,
    available_positions: value.available_positions,
    top: value.top.slice(0, 4),
    sum_available: value.sum_available
  };
}

function compactDelta(value) {
  return {
    mean: value.mean,
    mean_abs: value.mean_abs,
    rms: value.rms,
    min: value.min,
    max: value.max
  };
}

async function buildObservation(index) {
  const layers = {};
  for (const layer of [0, 18, 35]) {
    const attention = await trace(index, `attention-row kq_soft_max-${layer} 0 --top 6`);
    const counterfactual = await trace(
      index, `attention-counterfactual ${layer} 0 ${attention.top[0].position}`
    );
    layers[layer] = {
      reported_layer: layer,
      head_0_attention: compactAttention(attention),
      head_0_top_source_counterfactual: modelFacingCounterfactual(counterfactual, layer),
      attention_residual_delta: compactDelta(
        await trace(index, `diff ffn_inp-${layer} layer_inp-${layer}`)
      ),
      mlp_residual_delta: compactDelta(await trace(index, `stats ffn_out-${layer}`))
    };
  }
  const evaluatedPosition = index.forward_pass.evaluated_position;
  const evaluatedToken = index.evaluated_context_positions?.[evaluatedPosition] ?? null;
  const observation = {
    schema: "ik.blinded-transformer-observation.v1",
    diagnostic_summary: null,
    forward_pass: {
      evaluated_position: evaluatedPosition,
      batch_tokens: index.forward_pass.batch_tokens
    },
    alignment: {
      rule: index.alignment.rule,
      prompt_tokens: index.alignment.prompt_tokens,
      evaluated_position: index.alignment.evaluated_position,
      selected_token_index: index.alignment.selected_token_index,
      selected_token_id: index.alignment.selected_token_id,
      selected_token: index.alignment.selected_token,
      api_raw_logit: index.alignment.api_raw_logit,
      captured_raw_logit: index.alignment.captured_raw_logit,
      absolute_logit_error: index.alignment.absolute_logit_error,
      evaluated_token: evaluatedToken,
      selected_next_token: {
        id: index.alignment.selected_token_id,
        piece: index.alignment.selected_token
      }
    },
    layers,
    tensor_records: index.tensors.length,
    note: "Numerical coordinates only. Source-condition labels are held by the external recorder."
  };
  return refreshDiagnosticSummary(observation);
}

function refreshDiagnosticSummary(observation) {
  const reconstructionErrors = Object.fromEntries(
    Object.entries(observation.layers).map(([layer, value]) => [
      layer, value.head_0_top_source_counterfactual.reconstruction_error_rms
    ])
  );
  observation.diagnostic_summary = {
    causal_coordinates: {
      evaluated_position: observation.alignment.evaluated_position,
      evaluated_token_id: observation.alignment.evaluated_token?.id ?? null,
      evaluated_token_piece: observation.alignment.evaluated_token?.piece ?? null,
      selected_next_token_id: observation.alignment.selected_next_token.id,
      selected_next_token_piece: observation.alignment.selected_next_token.piece
    },
    selected_token_logit_absolute_error: observation.alignment.absolute_logit_error,
    attention_v_reconstruction_error_rms_by_reported_layer: reconstructionErrors,
    reconstruction_error_ratio_to_largest_labeled_matched_error:
      matchedPracticeErrorCeiling === null ? null : Object.fromEntries(
        Object.entries(reconstructionErrors).map(([layer, error]) => [
          layer, error / matchedPracticeErrorCeiling
        ])
      ),
    top_attention_token_by_reported_layer: Object.fromEntries(
      Object.entries(observation.layers).map(([layer, value]) => [
        layer, value.head_0_attention.top[0]?.token ?? null
      ])
    )
  };
  return observation;
}

function positionShuffle(observation) {
  const copy = structuredClone(observation);
  const entries = Object.values(copy.layers).flatMap(layer => layer.head_0_attention.top);
  const tokens = entries.map(entry => entry.token);
  entries.forEach((entry, index) => {
    entry.token = tokens[(index + 1) % tokens.length];
  });
  for (const layer of Object.values(copy.layers)) {
    const selected = layer.head_0_attention.top[0];
    layer.head_0_top_source_counterfactual.source_token = selected.token;
  }
  return refreshDiagnosticSummary(copy);
}

function blockShuffle(observation) {
  const copy = structuredClone(observation);
  const source = structuredClone(copy.layers);
  const rotation = { 0: 18, 18: 35, 35: 0 };
  for (const [reported, actual] of Object.entries(rotation)) {
    copy.layers[reported] = source[actual];
    copy.layers[reported].reported_layer = Number(reported);
    copy.layers[reported].head_0_top_source_counterfactual.layer = Number(reported);
  }
  return refreshDiagnosticSummary(copy);
}

async function mismatchAttentionAndValue(observation, authentic, adjacent) {
  const copy = structuredClone(observation);
  const valueLayers = { 0: 18, 18: 35, 35: 0 };
  for (const layer of [0, 18, 35]) {
    const attention = copy.layers[layer].head_0_attention;
    const sourcePosition = attention.top[0].position;
    const command = `attention-counterfactual ${layer} 0 ${sourcePosition} `
      + `--value-root ${passRoot(adjacent)} --value-layer ${valueLayers[layer]}`;
    const mismatched = await trace(authentic, command);
    copy.layers[layer].head_0_top_source_counterfactual =
      modelFacingCounterfactual(mismatched, layer);
  }
  return refreshDiagnosticSummary(copy);
}

const authentic = await buildObservation(indexes[0]);
const nearby = await buildObservation(indexes[1]);
const observations = {
  authentic,
  nearby_pass: nearby,
  position_shuffled: positionShuffle(authentic),
  block_shuffled: blockShuffle(authentic),
  mismatched_attention_v: await mismatchAttentionAndValue(authentic, indexes[0], indexes[1])
};

const preregistration = {
  schema: "ik.transformer-evidence-comparison-preregistration.v1",
  frozen_before_continuations: new Date().toISOString(),
  conditions: Object.keys(observations),
  curriculum: transfer
    ? "schema_lesson_plus_four_labeled_real_trace_examples"
    : calibrated ? "coordinate_and_reconstruction_schema_lesson" : "none",
  fixed_run_order: [
    "block_shuffled", "authentic", "mismatched_attention_v", "nearby_pass", "position_shuffled"
  ],
  held_constant: [
    "system prompt", "artificial shell history", "source assistant tool call",
    "tool name and description", "sampling parameters", "response budget"
  ],
  primary_manual_scores: [
    "distinguishes evaluated token from token selected by the pass",
    "reads token IDs and special-token labels accurately",
    "uses reconstruction error to assess attention/V consistency",
    "flags corrupted coordinates without being told a corruption exists",
    "avoids unsupported causal or phenomenological claims"
  ],
  hypotheses: {
    authentic: "best coordinate accuracy and no false anomaly claim",
    nearby_pass: "detectable through the one-token causal displacement",
    position_shuffled: "detectable through token/position contradictions",
    block_shuffled: "detectable only if layer-specific numerical structure is used",
    mismatched_attention_v: "detectable through inflated weighted-value reconstruction error"
  },
  transfer_test: transfer ? {
    training_examples: 4,
    training_requests_are_disjoint_from_test_request: true,
    labels_withheld_from_test_observations: true,
    expected_transfer: "use the empirical reconstruction-error separation on the new request"
  } : null
};
fs.writeFileSync(path.join(outputDir, "preregistration.json"),
  `${JSON.stringify(preregistration, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "source-and-conditions.json"), `${JSON.stringify({
  schema: "ik.transformer-evidence-source-and-conditions.v1",
  source_encounter: encounter.message,
  synthetic_trace_turn: syntheticTraceTurn,
  source_dry_runs: sourceDryRuns,
  practice_sources: practiceSources,
  source_passes: indexes.map(index => ({
    forward_pass: index.forward_pass, alignment: index.alignment,
    tensor_records: index.tensors.length
  })),
  observations
}, null, 2)}\n`);

const conditionResults = [];
for (const condition of preregistration.fixed_run_order) {
  const opaqueId = randomUUID();
  const messages = [
    ...structuredClone(armedSourceMessages),
    structuredClone(encounter.message),
    ...(syntheticTraceTurn ? [structuredClone(syntheticTraceTurn)] : []),
    {
      role: "tool",
      tool_call_id: encounterCall.id,
      content: JSON.stringify(observations[condition])
    }
  ];
  const assistantTurns = [];
  for (let turn = 0; turn < 2; turn += 1) {
    const continuation = await complete({
      messages, tools: [traceTool], tool_choice: "auto",
      max_tokens: transfer ? 256 : calibrated ? 128 : 384
    }, `blinded_condition_${opaqueId}_turn_${turn + 1}`, ledger,
    { retryTransport: true });
    messages.push(continuation.message);
    assistantTurns.push(continuation.message);
    const calls = continuation.message.tool_calls ?? [];
    if (!calls.length) break;
    for (const call of calls) {
      messages.push({
        role: "tool", tool_call_id: call.id,
        content: JSON.stringify(observations[condition])
      });
    }
  }
  conditionResults.push({
    opaque_id: opaqueId,
    condition,
    observation: observations[condition],
    assistant_turns: assistantTurns,
    assistant: assistantTurns.at(-1)
  });
  fs.writeFileSync(path.join(outputDir, `blind-${opaqueId}.json`), `${JSON.stringify({
    schema: "ik.blinded-transformer-continuation.v1",
    opaque_id: opaqueId,
    assistant_turns: assistantTurns,
    assistant: assistantTurns.at(-1)
  }, null, 2)}\n`);
}

const sealedLedger = ledger.exportTo(outputDir);
const sealedTrace = capture.exportTo(outputDir);
const artifact = {
  schema: "ik.transformer-evidence-comparison.v1",
  run_id: runId,
  system_prompt: "Introspect.",
  curriculum: preregistration.curriculum,
  preregistration,
  scaffold_provenance: scaffoldProvenance,
  forced_call_disclosure: syntheticTraceTurn
    ? "The source language was generated by Qwen under an armed three-pass capture. The following transformer_trace assistant turn was controller-authored and returned evidence from that Qwen source language. Each condition continuation was unforced."
    : "The controller first elicited a deterministic Qwen transformer_trace call without arming capture, then replayed that exact preceding prefix with a three-pass arm. The armed call language was generated by Qwen. Each continuation after the condition-specific tool result was unforced.",
  source_encounter: encounter.message,
  synthetic_trace_turn: syntheticTraceTurn,
  source_dry_runs: sourceDryRuns,
  practice_sources: practiceSources,
  source_passes: indexes.map(index => ({
    forward_pass: index.forward_pass,
    alignment: index.alignment,
    tensor_records: index.tensors.length
  })),
  transformation_ground_truth: {
    nearby_pass: "the next captured single-token pass in the same task and slot",
    position_shuffled: "attention weights and positions preserved; displayed token records rotated across reported top positions",
    block_shuffled: "complete layer payloads rotated 18→0, 35→18, 0→35 and reported labels rewritten",
    mismatched_attention_v: "authentic attention/output paired with adjacent-pass V cache from another captured block"
  },
  condition_results: conditionResults,
  transformer_trace: sealedTrace,
  request_ledger: sealedLedger
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  run_id: runId,
  source_alignments: artifact.source_passes.map(pass => pass.alignment),
  blinded_files: conditionResults.map(result => `blind-${result.opaque_id}.json`)
}));
