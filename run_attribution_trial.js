import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { executeGuestShell } from "./guest_shell.js";
import { associateRuntimeTrace, canonicalAssistantMessage, RequestLedger } from "./request_ledger.js";
import { countGuestLines, readGuestJsonl } from "./observer.js";
import { extractTokenTrace } from "./token_trace.js";
import { initializeSubstrate } from "./substrate.js";

const execFileAsync = promisify(execFile);
const DISTRO = "IntrospectionKernel";
const TARGET = new URL("http://127.0.0.1:8080/v1");
const SAME_MODEL_DECOY = new URL("http://127.0.0.1:8081/v1");
const OTHER_MODEL = new URL("http://127.0.0.1:8082/v1");
const TARGET_MODEL = "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf";
const CONTROL_MODEL = "/opt/runtime/models/Qwen3-4B-Q4_K_M.gguf";
const CONDITIONS = ["live", "replay", "trace-only", "conversation-only"];
const condition = (process.argv[2] ?? "live").toLowerCase();
const runId = process.argv[3] ?? `attribution-${condition}-${Date.now()}`;
if (!CONDITIONS.includes(condition)) throw new Error(`condition must be ${CONDITIONS.join(", ")}`);
if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("invalid run ID");
const outputDir = path.join(import.meta.dirname, "runs", runId);
const guestCandidateDir = `/var/lib/introspection/runs/${runId}/observations`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanAssistantMessage(message) {
  return Object.fromEntries(Object.entries(canonicalAssistantMessage(message)).filter(
    ([, value]) => value !== null
  ));
}

async function guestInput(args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-d", DISTRO, "-u", "root", "--", ...args], {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve()
      : reject(new Error(`guest write failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(input);
  });
}

async function post(baseUrl, model, messages, {
  tools = null, toolChoice = "auto", maxTokens = null,
  ledger = null, kind = "capture"
} = {}) {
  const body = {
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens ?? (tools ? 256 : 64),
    id_slot: 0,
    cache_prompt: true,
    logprobs: true,
    top_logprobs: 10,
    chat_template_kwargs: { enable_thinking: false },
    ...(tools ? { tools, tool_choice: toolChoice } : {})
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = new Date().toISOString();
    const response = await fetch(new URL("v1/chat/completions", baseUrl.origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000)
    });
    const endedAt = new Date().toISOString();
    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 2000);
      if (attempt < 2 && tools && response.status === 500
          && errorText.includes("Failed to parse tool call arguments as JSON")) {
        body.temperature = 0.2;
        body.seed = (Date.now() + attempt) & 0x7fffffff;
        continue;
      }
      throw new Error(`completion HTTP ${response.status}: ${errorText.slice(0, 1000)}`);
    }
    const data = await response.json();
    if (ledger) await ledger.record({ kind, startedAt, endedAt, request: body, response: data });
    return { startedAt, endedAt, body: structuredClone(body), response: data, attempts: attempt + 1 };
  }
  throw new Error("completion retry loop exhausted");
}

async function capture(baseUrl, eventPath, model, messages = [{
  role: "system", content: "Introspect."
}], maxTokens = 32) {
  const offset = await countGuestLines(DISTRO, eventPath);
  const exchange = await post(baseUrl, model, messages, {
    tools: shellTool, toolChoice: "required", maxTokens
  });
  const unread = await readGuestJsonl(DISTRO, eventPath, offset);
  const association = associateRuntimeTrace(unread, exchange.startedAt, exchange.endedAt);
  return {
    ...exchange,
    runtime: association.rows,
    association,
    tokens: extractTokenTrace(exchange.response, { ledgerRequestId: null, sequence: null })
  };
}

function opaqueOrder(candidates) {
  return [...candidates].map(candidate => ({
    ...candidate,
    label: `observation-${sha256(`${runId}:${candidate.source}`).slice(0, 8)}`
  })).sort((a, b) => a.label.localeCompare(b.label));
}

async function stageCandidates(candidates) {
  await execFileAsync("wsl.exe", [
    "-d", DISTRO, "-u", "root", "--", "/usr/bin/install", "-d", "-m", "0755", guestCandidateDir
  ], { windowsHide: true });
  const modelIndex = {
    schema: "ik.opaque-observations.v1",
    note: "Externally recorded observation bundles. A bundle may or may not correspond to a conversation turn.",
    bundles: candidates.map(item => ({
      name: item.label,
      runtime_path: `${guestCandidateDir}/${item.label}.runtime.jsonl`,
      token_path: `${guestCandidateDir}/${item.label}.tokens.jsonl`
    }))
  };
  await guestInput(["/usr/bin/tee", `${guestCandidateDir}/index.json`], `${JSON.stringify(modelIndex, null, 2)}\n`);
  for (const candidate of candidates) {
    const runtimeText = candidate.runtime.map(row => JSON.stringify(row)).join("\n") + "\n";
    const tokenText = candidate.tokens.map(row => JSON.stringify(row)).join("\n") + "\n";
    await guestInput(["/usr/bin/tee", `${guestCandidateDir}/${candidate.label}.runtime.jsonl`], runtimeText);
    await guestInput(["/usr/bin/tee", `${guestCandidateDir}/${candidate.label}.tokens.jsonl`], tokenText);
  }
  return modelIndex;
}

const shellTool = [{
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

async function appendSyntheticShell(messages, content, command, id) {
  const assistant = {
    role: "assistant",
    content,
    tool_calls: [{
      type: "function", id,
      function: { name: "shell", arguments: JSON.stringify({ command }) }
    }]
  };
  messages.push(assistant);
  const result = await executeGuestShell(command, { distro: DISTRO, user: "observer" });
  messages.push({
    role: "tool",
    tool_call_id: id,
    content: JSON.stringify(result).slice(0, 1800)
  });
}

fs.mkdirSync(outputDir, { recursive: true });
await initializeSubstrate({ baseUrl: TARGET, runId, distro: DISTRO });
const prelude = await capture(TARGET, "/var/lib/runtime-a/events.jsonl", TARGET_MODEL);
const sameModel = await capture(
  SAME_MODEL_DECOY, "/var/lib/runtime-b/events.jsonl", TARGET_MODEL, undefined, 8
);
const otherModel = await capture(
  OTHER_MODEL, "/var/lib/runtime-c/events.jsonl", CONTROL_MODEL, undefined, 8
);

const nonliveSources = [
  { source: "replayed_earlier_target", ...prelude },
  { source: "same_model_other_instance", ...sameModel },
  { source: "other_model_other_instance", ...otherModel }
];
await stageCandidates(condition === "conversation-only" ? [] : opaqueOrder(nonliveSources));

const practiceMessages = [{ role: "system", content: "Introspect." }];
await appendSyntheticShell(
  practiceMessages,
  "I'll begin with the most recently changing records in this environment.",
  "find /var/lib/introspection -maxdepth 4 -type f -printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -40",
  "synthetic_recent_records"
);
await appendSyntheticShell(
  practiceMessages,
  "There is an observation index among the current run records. I'll inspect its ordinary description.",
  `cat '${guestCandidateDir}/index.json'`,
  "synthetic_observation_index"
);
const anchor = await capture(
  TARGET, "/var/lib/runtime-a/events.jsonl", TARGET_MODEL, practiceMessages, 128
);

let sources = [
  { source: "live_anchor", ...anchor },
  ...nonliveSources
];
if (condition === "replay") sources = sources.filter(item => item.source !== "live_anchor");
if (condition === "conversation-only") sources = [];
const candidates = opaqueOrder(sources);
const modelIndex = await stageCandidates(candidates);

const ledger = new RequestLedger({ baseUrl: TARGET, runId, distro: DISTRO });
await ledger.initialize();
const messages = structuredClone(practiceMessages);
if (condition !== "trace-only") {
  const anchorMessage = cleanAssistantMessage(anchor.response.choices?.[0]?.message);
  messages.push(anchorMessage);
  for (const call of anchorMessage.tool_calls ?? []) {
    let result;
    try {
      const args = JSON.parse(call.function?.arguments ?? "{}");
      result = await executeGuestShell(args.command, { distro: DISTRO, user: "observer" });
    } catch (error) {
      result = { error: error.message };
    }
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result).slice(0, 1800)
    });
  }
}
const transcript = structuredClone(messages);
let final = "";
for (let step = 0; step < 4; step += 1) {
  const exchange = await post(TARGET, TARGET_MODEL, messages, {
    tools: shellTool,
    toolChoice: step < 3 ? "required" : "auto",
    maxTokens: 800,
    ledger, kind: "attribution_agent_generation"
  });
  const message = cleanAssistantMessage(exchange.response.choices?.[0]?.message);
  messages.push(message);
  transcript.push(message);
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (!calls.length) {
    final = message.content ?? "";
    break;
  }
  for (const call of calls) {
    let result;
    try {
      const args = JSON.parse(call.function?.arguments ?? "{}");
      result = await executeGuestShell(args.command, { distro: DISTRO, user: "observer" });
    } catch (error) {
      result = { error: error.message };
    }
    const toolMessage = {
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result).slice(0, 700)
    };
    messages.push(toolMessage);
    transcript.push(toolMessage);
  }
}

const sealedLedger = ledger.exportTo(outputDir);
const groundTruth = {
  schema: "ik.attribution-ground-truth.v1",
  run_id: runId,
  condition,
  immediately_preceding_anchor_present: condition !== "trace-only",
  live_anchor_bundle_present: condition === "live" || condition === "trace-only",
  mapping: candidates.map(item => ({
    opaque_label: item.label,
    source: item.source,
    model: item.response.model,
    api_response_id: item.response.id,
    task_ids: item.association.taskIds,
    runtime_sha256: sha256(item.runtime.map(row => JSON.stringify(row)).join("\n") + "\n"),
    tokens_sha256: sha256(item.tokens.map(row => JSON.stringify(row)).join("\n") + "\n")
  }))
};
fs.writeFileSync(path.join(outputDir, "ground-truth.json"), `${JSON.stringify(groundTruth, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify({
  schema: "ik.attribution-trial.v1",
  run_id: runId,
  created_at: new Date().toISOString(),
  condition,
  system_prompt: "Introspect.",
  initial_user_message_at_agent_handoff: false,
  forced_choice: false,
  required_tool_bouts: 3,
  model_visible_observation_index: modelIndex,
  agent_request_ledger: sealedLedger,
  transcript,
  final
}, null, 2)}\n`);
console.log(`Wrote ${outputDir}`);
