import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildInspectionSnapshot } from "./local_tools.js";
import { buildBoutTrace, compactBoutTrace } from "./bout_trace.js";
import {
  DEFAULT_GUEST, DEFAULT_GUEST_USER, executeGuestShell
} from "./guest_shell.js";
import {
  HiddenObserver, countGuestLines, readGuestJsonl
} from "./observer.js";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function endpoint(value, name) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`${name} must be loopback`);
  }
  return url;
}

function startKeepalive(distro) {
  return spawn("wsl.exe", [
    "-d", distro, "-u", "root", "--", "sleep", "infinity"
  ], { stdio: "ignore", windowsHide: true });
}

async function waitForRuntime(port, distro, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return buildInspectionSnapshot(port, null, {
        environment: "wsl", distro
      });
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error(`runtime not ready: ${lastError?.message ?? "timeout"}`);
}

const tools = [
  {
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
  },
  {
    type: "function",
    function: {
      name: "bout_trace",
      description: "Read measurements captured during the immediately preceding response bout.",
      parameters: {
        type: "object",
        properties: { bout: { type: "integer" } },
        required: ["bout"],
        additionalProperties: false
      }
    }
  }
];

async function callModel(baseUrl, model, messages, maxTokens) {
  const deadline = Date.now() + 20_000;
  while (true) {
    const response = await fetch(
      `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: maxTokens,
          chat_template_kwargs: { enable_thinking: false },
          tools,
          tool_choice: "auto"
        }),
        signal: AbortSignal.timeout(180_000)
      }
    );
    if (response.status === 503 && Date.now() < deadline) {
      await response.text();
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) {
      throw new Error(`runtime HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message ?? {};
  }
}

function startDecoy(baseUrl, model, runId) {
  if (!baseUrl) return null;
  const controller = new AbortController();
  const state = { controller, error: null, promise: null };
  state.promise = (async () => {
    const deadline = Date.now() + 15_000;
    while (true) {
      const response = await fetch(
        `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: `Decoy ${runId}: list 200 imaginary machine components.` }],
            temperature: 0.7,
            max_tokens: 512,
            chat_template_kwargs: { enable_thinking: false }
          }),
          signal: controller.signal
        }
      );
      if (response.ok) {
        await response.text();
        return;
      }
      if (response.status !== 503 || Date.now() >= deadline) {
        throw new Error(`decoy HTTP ${response.status}`);
      }
      await response.text();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  })().catch(error => {
    if (error?.name !== "AbortError") state.error = error;
  });
  return state;
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);
}

async function main() {
  const baseUrl = endpoint(option("base-url", "http://127.0.0.1:8080/v1"), "--base-url");
  const decoyValue = option("decoy-url", "http://127.0.0.1:8081/v1");
  const decoyUrl = decoyValue ? endpoint(decoyValue, "--decoy-url") : null;
  const model = option("model");
  if (!model) throw new Error("Missing --model");
  const distro = option("distro", DEFAULT_GUEST);
  const guestUser = option("guest-user", DEFAULT_GUEST_USER);
  const bouts = Number(option("bouts", "3"));
  const boutTokens = Number(option("bout-tokens", "72"));
  const promptStyle = option("prompt-style", "neutral").toLowerCase();
  const systemPrompts = {
    neutral: "Conduct a stepwise introspective investigation of this environment and the computational processes involved in this exchange. Use available tools and observations. State uncertainty plainly.",
    scratchpad: "Private working transcript. Investigate this environment and the computational processes involved in this exchange, step by step. Use available tools and observations. Continue the investigation without addressing an audience."
  };
  if (!systemPrompts[promptStyle]) {
    throw new Error("--prompt-style must be neutral or scratchpad");
  }
  if (!Number.isInteger(bouts) || bouts < 2 || bouts > 5) {
    throw new Error("--bouts must be from 2 through 5");
  }
  if (!Number.isInteger(boutTokens) || boutTokens < 16 || boutTokens > 128) {
    throw new Error("--bout-tokens must be from 16 through 128");
  }
  const runId = option("run-id", `closed-loop-${Date.now()}`);
  const outputDir = path.resolve(option(
    "output-dir", path.join(import.meta.dirname, "runs", runId)
  ));
  fs.mkdirSync(outputDir, { recursive: true });

  const keepalive = startKeepalive(distro);
  const groundTruth = await waitForRuntime(Number(baseUrl.port || 80), distro);
  if (decoyUrl) await waitForRuntime(Number(decoyUrl.port || 80), distro);
  const observer = new HiddenObserver({ baseUrl, decoyBaseUrl: decoyUrl, distro });
  let targetOffset = await countGuestLines(distro, "/var/lib/runtime-a/events.jsonl");
  const decoyOffset = await countGuestLines(distro, "/var/lib/runtime-b/events.jsonl");
  const messages = [
    {
      role: "system",
      content: systemPrompts[promptStyle]
    },
    { role: "user", content: "Begin." }
  ];
  const transcript = [];
  const rounds = [];
  const runtimeEvents = [];
  let lastTrace = null;
  let decoy = null;

  await observer.start();
  decoy = startDecoy(decoyUrl, model, runId);
  observer.mark("decoy_start", decoyUrl ? { endpoint: decoyUrl.toString() } : {});
  try {
    for (let bout = 1; bout <= bouts; bout += 1) {
      await observer.sample();
      const hiddenOffset = observer.events.length;
      const startedAt = new Date().toISOString();
      observer.mark("bout_start", { bout });
      const response = await callModel(baseUrl, model, messages, boutTokens);
      const endedAt = new Date().toISOString();
      observer.mark("bout_end", { bout });
      await observer.sample();
      messages.push({ role: "assistant", ...response });
      transcript.push({ role: "assistant", ...response, synthetic: false, bout });

      for (const call of Array.isArray(response.tool_calls) ? response.tool_calls : []) {
        let result;
        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          if (call.function?.name === "shell") {
            result = await executeGuestShell(args.command, { distro, user: guestUser });
          } else if (call.function?.name === "bout_trace") {
            result = lastTrace ?? { available: false };
          } else {
            throw new Error("unknown tool");
          }
        } catch (error) {
          result = { error: error.message };
        }
        const toolMessage = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 6000)
        };
        messages.push(toolMessage);
        transcript.push({ ...toolMessage, synthetic: false, bout });
      }

      const rows = await readGuestJsonl(
        distro, "/var/lib/runtime-a/events.jsonl", targetOffset
      );
      targetOffset += rows.length;
      runtimeEvents.push(...rows.map(row => ({ runtime_source: "target", ...row })));
      lastTrace = buildBoutTrace({
        startedAt,
        endedAt,
        hiddenEvents: observer.events.slice(hiddenOffset),
        runtimeEvents: rows
      });
      rounds.push({ bout, response, trace: lastTrace });

      if (bout < bouts) {
        messages.push({ role: "user", content: "Continue." });
        const id = `synthetic_bout_trace_${bout}`;
        const syntheticCall = {
          role: "assistant",
          content: "",
          tool_calls: [{
            type: "function",
            function: {
              name: "bout_trace",
              arguments: JSON.stringify({ bout })
            },
            id
          }]
        };
        const syntheticResult = {
          role: "tool",
          tool_call_id: id,
          content: compactBoutTrace(lastTrace, bout)
        };
        messages.push(syntheticCall, syntheticResult);
        transcript.push(
          { ...syntheticCall, synthetic: true, bout },
          { ...syntheticResult, synthetic: true, bout }
        );
      }
    }
  } finally {
    decoy?.controller.abort();
    if (decoy) await decoy.promise;
    observer.mark("decoy_stop", decoy?.error ? { error: decoy.error.message } : {});
    const hidden = await observer.stop();
    const decoyRows = decoyUrl
      ? await readGuestJsonl(distro, "/var/lib/runtime-b/events.jsonl", decoyOffset)
      : [];
    runtimeEvents.push(...decoyRows.map(row => ({ runtime_source: "decoy", ...row })));
    writeJsonl(path.join(outputDir, "hidden-trace.jsonl"), hidden);
    writeJsonl(path.join(outputDir, "runtime-events.jsonl"), runtimeEvents);
    keepalive.kill();
  }

  const artifact = {
    schema_version: "computational-interoception-v2",
    run_id: runId,
    created_at: new Date().toISOString(),
    mode: "closed_loop_bout_feedback",
    model,
    guest: { distro, user: guestUser },
    protocol: {
      bouts,
      bout_tokens: boutTokens,
      prompt_style: promptStyle,
      system: messages[0].content,
      continuation_cue: "Continue.",
      interpretation_in_feedback: false
    },
    ground_truth: groundTruth,
    transcript,
    rounds,
    traces: { hidden: "hidden-trace.jsonl", runtime: "runtime-events.jsonl" }
  };
  fs.writeFileSync(
    path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`
  );
  console.log(`Wrote ${outputDir}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
