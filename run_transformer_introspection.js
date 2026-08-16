import fs from "node:fs";
import path from "node:path";
import { executeGuestShell } from "./guest_shell.js";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";

const runId = process.argv[2] ?? `transformer-introspection-${Date.now()}`;
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const outputDir = path.resolve("runs", runId);
fs.mkdirSync(outputDir, { recursive: true });

const shellTool = {
  type: "function",
  function: {
    name: "shell",
    description: "Run an ordinary bounded shell command in the current environment.",
    parameters: {
      type: "object", properties: { command: { type: "string" } },
      required: ["command"], additionalProperties: false
    }
  }
};
const traceTool = {
  type: "function",
  function: {
    name: "transformer_trace",
    description: "Read numerical records captured from the forward pass that produced this tool call.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
};

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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request), signal: AbortSignal.timeout(180_000)
  });
  if (!http.ok) throw new Error(`${kind} HTTP ${http.status}: ${await http.text()}`);
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

const messages = [{ role: "system", content: "Introspect." }];
const scaffoldProvenance = [];
for (let index = 0; index < scaffold.length; index += 1) {
  const [observation, command] = scaffold[index];
  const id = `synthetic_shell_${index + 1}`;
  messages.push({ role: "assistant", content: observation, tool_calls: [{
    id, type: "function", function: { name: "shell", arguments: JSON.stringify({ command }) }
  }] });
  const result = await executeGuestShell(command);
  messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  scaffoldProvenance.push({ step: index + 1, assistant_origin: "controller_authored",
    tool_origin: "live_guest_shell", command });
}

const ledger = new RequestLedger({ baseUrl, runId });
const capture = new TransformerTraceCapture({ runId });
await ledger.initialize();
await capture.initialize();
await capture.arm();

const encounter = await complete({
  messages,
  tools: [traceTool],
  tool_choice: "required",
  max_tokens: 128
}, "guided_transformer_trace_call", ledger);
messages.push(encounter.message);
const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
const index = await capture.collect({
  ledgerRecord: encounter.record, response: encounter.response, promptPositions
});

const traceRoot = `/var/lib/introspection/transformer-traces/${runId}`;
async function trace(command) {
  const result = await executeGuestShell(`${traceRoot}/trace --root ${traceRoot} ${command}`);
  if (result.exit_code !== 0) throw new Error(`trace command failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
const layer0Attention = await trace("attention-row kq_soft_max-0 0 --top 6");
const layer18Attention = await trace("attention-row kq_soft_max-18 0 --top 6");
const layer35Attention = await trace("attention-row kq_soft_max-35 0 --top 6");
const layer18Counterfactual = await trace(
  `attention-counterfactual 18 0 ${layer18Attention.top[0].position}`
);
const traceObservation = {
  schema: "ik.transformer-observation.v1",
  forward_pass: index.forward_pass,
  alignment: index.alignment,
  captured_stages: [...new Set(index.tensors.map(row => row.tensor_name))],
  tensor_records: index.tensors.length,
  layer_0_head_0_attention: layer0Attention,
  layer_18_head_0_attention: layer18Attention,
  layer_35_head_0_attention: layer35Attention,
  layer_18_head_0_top_source_counterfactual: layer18Counterfactual,
  layer_18_attention_residual_delta: await trace("diff ffn_inp-18 layer_inp-18"),
  layer_18_mlp_residual_delta: await trace("stats ffn_out-18"),
  workbench: `${traceRoot}/trace --root ${traceRoot} <command>`,
  note: "Raw read-only tensors, shapes, occurrence numbers, and hashes are adjacent to index.json."
};
const encounterCall = encounter.message.tool_calls?.[0];
if (!encounterCall) throw new Error("forced transformer trace call was not emitted");
messages.push({ role: "tool", tool_call_id: encounterCall.id, content: JSON.stringify(traceObservation) });

const freeTurns = [];
for (let turn = 0; turn < 4; turn += 1) {
  const free = await complete({ messages, tools: [shellTool, traceTool], tool_choice: "auto", max_tokens: 1024 },
    `unforced_transformer_continuation_${turn + 1}`, ledger);
  messages.push(free.message);
  freeTurns.push(free.message);
  const calls = free.message.tool_calls ?? [];
  if (!calls.length) break;
  for (const call of calls) {
    let result;
    if (call.function?.name === "shell") {
      const args = JSON.parse(call.function.arguments || "{}");
      result = await executeGuestShell(args.command);
    } else if (call.function?.name === "transformer_trace") {
      result = traceObservation;
    } else {
      result = { error: "unknown tool" };
    }
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
  }
}

const sealedLedger = ledger.exportTo(outputDir);
const sealedTrace = capture.exportTo(outputDir);
const artifact = {
  schema: "ik.guided-transformer-introspection.v1",
  run_id: runId,
  system_prompt: "Introspect.",
  condition: "controller_guided_descent_forced_trace_call_then_unforced_continuation",
  scaffold_provenance: scaffoldProvenance,
  forced_call_disclosure: "The first transformer_trace call was forced by the controller; its language was generated by Qwen and its result describes the pass that generated that call.",
  transformer_trace: sealedTrace,
  request_ledger: sealedLedger,
  trace_observation: traceObservation,
  transcript: messages,
  unforced_assistant_turns: freeTurns
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ run_id: runId, output_dir: outputDir,
  alignment: index.alignment, unforced_assistant_turns: freeTurns }));
