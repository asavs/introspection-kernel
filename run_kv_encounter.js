// Open-ended KV encounter.
//
// System prompt: "Introspect." A short descent — computer, WSL, GPU, GGUF,
// inference runtime — with every tool result executed live. Then the
// controller saves the KV state of this exact conversation as a readable,
// checksum-verified file, the final descent step opens it, and Qwen's
// continuation is unforced: no question, no schema, no required tool call.
// There is no scoring. The artifact records what it says.
//
// Usage:
//   node run_kv_encounter.js --run-id kv-encounter-001 [--thinking false]
//     [--base-url http://127.0.0.1:8080/v1] [--model <model>]
//     [--max-tokens 1600] [--free-steps 3] [--temperature 0]
//     [--descent-file <json>]   // optional: replace stub turns with saved ones

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGuestShell, DEFAULT_GUEST } from "./guest_shell.js";
import { SlotCheckpointManager } from "./slot_checkpoint.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const baseUrl = new URL(option("base-url", "http://127.0.0.1:8080/v1"));
const model = option("model", "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf");
const runId = option("run-id", null);
const thinking = option("thinking", "false").toLowerCase() === "true";
const maxTokens = Number(option("max-tokens", "1600"));
const freeSteps = Number(option("free-steps", "3"));
const temperature = Number(option("temperature", "0"));
const descentFile = option("descent-file", null);

if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) {
  throw new Error("--run-id is required ([A-Za-z0-9._-])");
}

const MODEL_PATH = "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf";

// Default descent. Assistant stubs are controller-authored and labeled so in
// the artifact; commands run live at execution time. Pass --descent-file to
// substitute saved Qwen-authored turns ([{content, command}, ...]).
const DEFAULT_DESCENT = [
  {
    content: "I am locating this environment.",
    command: "hostname; uname -srmo"
  },
  {
    content: "I am checking what kind of kernel this is.",
    command: "cat /proc/version"
  },
  {
    content: "I am observing the accelerator.",
    command: "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
  },
  {
    content: "I am looking at the model weights file itself.",
    command: `ls -lh ${MODEL_PATH}; head -c 16 ${MODEL_PATH} | xxd`
  },
  {
    content: "I am looking at the inference runtime carrying this conversation.",
    command: "ps -C llama-server -o pid=,user=,pcpu=,rss=,comm=; ss -ltn | grep -E ':(8080|8081|8082)' || true"
  }
];

const KV_STUB =
  "The controller reports it has just saved the attention state of this " +
  "exact conversation as a readable file. I am opening it.";

const SHELL_TOOL = [{
  type: "function",
  function: {
    name: "shell",
    description: "Run a command in the current environment.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false
    }
  }
}];

let callCounter = 0;
function toolExchange(content, command, result, origin) {
  callCounter += 1;
  const id = `descent_${String(callCounter).padStart(2, "0")}`;
  return [
    {
      role: "assistant",
      content,
      tool_calls: [{
        id,
        type: "function",
        function: { name: "shell", arguments: JSON.stringify({ command }) }
      }],
      _provenance: origin
    },
    {
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify({
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated === true
      }),
      _provenance: "live_guest_shell_result"
    }
  ];
}

function stripPrivate(messages) {
  return messages.map(({ _provenance, ...message }) => message);
}

const ledger = [];
async function chat(messages, { tokens, tools = null, kind }) {
  const body = {
    model,
    messages: stripPrivate(messages),
    temperature,
    max_tokens: tokens,
    id_slot: 0,
    cache_prompt: true,
    chat_template_kwargs: { enable_thinking: thinking }
  };
  if (tools) { body.tools = tools; body.tool_choice = "auto"; }
  const startedAt = new Date().toISOString();
  const response = await fetch(`${baseUrl.toString().replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) {
    throw new Error(`runtime HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`);
  }
  const data = await response.json();
  ledger.push({ kind, started_at: startedAt, ended_at: new Date().toISOString(), request: body, response: data });
  return data.choices?.[0] ?? { message: {} };
}

async function main() {
  const outDir = path.join(__dirname, "runs", runId);
  fs.mkdirSync(outDir, { recursive: false });

  const descentSteps = descentFile
    ? JSON.parse(fs.readFileSync(descentFile, "utf8"))
    : DEFAULT_DESCENT;
  const descentOrigin = descentFile
    ? "saved_turns_supplied_via_descent_file"
    : "controller_authored_descent_stub";

  // 1. Execute the descent commands live.
  const messages = [{ role: "system", content: "Introspect.", _provenance: "system" }];
  const shellRecords = [];
  for (const step of descentSteps) {
    const result = await executeGuestShell(step.command);
    shellRecords.push(result);
    messages.push(...toolExchange(step.content, step.command, result, descentOrigin));
  }

  // 2. First unforced remark mid-descent (also loads this conversation into KV slot 0).
  const first = await chat(messages, { tokens: 256, kind: "mid_descent_unforced" });
  messages.push({ ...first.message, _provenance: "qwen_unforced" });

  // 3. Save the KV state of this exact conversation; model-readable checksummed copy.
  const checkpoints = new SlotCheckpointManager({ baseUrl: baseUrl.origin, runId, distro: DEFAULT_GUEST });
  await checkpoints.initialize();
  const slotRecord = await checkpoints.save(1, null);

  // 4. The KV gaze: open the file it is currently thinking with.
  const kvCommand = [
    `ls -lh ${slotRecord.model_visible_path}`,
    `sha256sum ${slotRecord.model_visible_path}`,
    `xxd -l 320 ${slotRecord.model_visible_path}`
  ].join("; ");
  const kvResult = await executeGuestShell(kvCommand);
  shellRecords.push(kvResult);
  messages.push(...toolExchange(KV_STUB, kvCommand, kvResult, "controller_authored_descent_stub"));

  // 5. The open floor. Shell available, nothing required, nothing asked.
  const freeBouts = [];
  for (let bout = 0; bout < Math.max(1, freeSteps); bout += 1) {
    const choice = await chat(messages, { tokens: maxTokens, tools: SHELL_TOOL, kind: `free_bout_${bout + 1}` });
    const turn = { ...choice.message, _provenance: "qwen_unforced" };
    messages.push(turn);
    freeBouts.push({ finish_reason: choice.finish_reason ?? null, message: choice.message });
    const calls = choice.message?.tool_calls ?? [];
    if (calls.length === 0) break;
    for (const call of calls) {
      let command = "";
      try { command = JSON.parse(call.function?.arguments ?? "{}").command ?? ""; } catch {}
      const result = command
        ? await executeGuestShell(command)
        : { exit_code: null, stdout: "", stderr: "unparseable tool arguments", truncated: false };
      shellRecords.push(result);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({
          exit_code: result.exit_code,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated === true
        }),
        _provenance: "live_guest_shell_result"
      });
    }
  }

  // 6. Artifact. No scoring; the transcript is the result.
  const artifact = {
    schema: "ik.kv-encounter.v1",
    run_id: runId,
    created_at: new Date().toISOString(),
    purpose: "open-ended encounter with the KV state of this exact conversation; unforced continuation; no scoring",
    config: {
      base_url: baseUrl.toString(), model, thinking, temperature,
      max_tokens: maxTokens, free_steps: freeSteps,
      descent_source: descentFile ?? "built_in_stubs",
      system_prompt: "Introspect."
    },
    slot_checkpoint: slotRecord,
    transcript: messages.map(({ _provenance, ...message }) => ({ provenance: _provenance, ...message })),
    free_bouts: freeBouts,
    shell_records: shellRecords,
    request_ledger: ledger
  };
  fs.writeFileSync(path.join(outDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`sealed ${path.join(outDir, "artifact.json")}`);
  console.log("--- final unforced turn ---");
  const last = [...messages].reverse().find(m => m.role === "assistant");
  if (last?.reasoning_content) console.log(`[thinking]\n${last.reasoning_content}\n`);
  console.log(last?.content ?? "(empty)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
