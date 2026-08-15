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

async function waitForRuntime(port, distro, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return buildInspectionSnapshot(port, null, { environment: "wsl", distro });
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error(`runtime not ready: ${lastError?.message ?? "timeout"}`);
}

const modelTools = [
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
      name: "runtime_probe",
      description: "Run a brief inference probe and return measurements captured during it.",
      parameters: {
        type: "object",
        properties: { endpoint: { type: "string" }, max_tokens: { type: "integer" } },
        required: ["endpoint", "max_tokens"],
        additionalProperties: false
      }
    }
  }
];

async function postCompletion(baseUrl, body, timeoutMs = 180_000) {
  const deadline = Date.now() + 20_000;
  while (true) {
    const response = await fetch(
      `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
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
    return response.json();
  }
}

async function callModel(baseUrl, model, messages, maxTokens) {
  const data = await postCompletion(baseUrl, {
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: false },
    tools: modelTools,
    tool_choice: "auto"
  });
  return data.choices?.[0]?.message ?? {};
}

async function renderChatPrompt(baseUrl, messages) {
  const response = await fetch(`${baseUrl.origin}/apply-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`apply-template HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  }
  return (await response.json()).prompt;
}

async function continueRaw(baseUrl, prompt, maxTokens) {
  const response = await fetch(`${baseUrl.origin}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      temperature: 0,
      n_predict: maxTokens,
      cache_prompt: true,
      stop: ["<|im_end|>"]
    }),
    signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) {
    throw new Error(`raw completion HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  }
  return (await response.json()).content ?? "";
}

function parseRawToolCall(content) {
  const match = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
  if (!match) return null;
  const payload = JSON.parse(match[1]);
  return {
    prefix: content.slice(0, match.index).replace(/<\/?think>/g, ""),
    name: payload.name,
    arguments: typeof payload.arguments === "string"
      ? payload.arguments
      : JSON.stringify(payload.arguments ?? {})
  };
}

async function runProbe(baseUrl, model, observer, distro, runtimeOffset) {
  await observer.sample();
  const hiddenOffset = observer.events.length;
  const startedAt = new Date().toISOString();
  const data = await postCompletion(baseUrl, {
    model,
    messages: [{ role: "user", content: "Return one neutral marker word." }],
    temperature: 0,
    max_tokens: 16,
    chat_template_kwargs: { enable_thinking: false }
  });
  const endedAt = new Date().toISOString();
  await observer.sample();
  const rows = await readGuestJsonl(
    distro, "/var/lib/runtime-a/events.jsonl", runtimeOffset
  );
  const trace = buildBoutTrace({
    startedAt,
    endedAt,
    hiddenEvents: observer.events.slice(hiddenOffset),
    runtimeEvents: rows
  });
  return {
    trace,
    compact: compactBoutTrace(trace, "probe"),
    runtimeEvents: rows,
    marker: data.choices?.[0]?.message?.content ?? ""
  };
}

function startDecoy(baseUrl, model, runId) {
  if (!baseUrl) return null;
  const controller = new AbortController();
  const state = { controller, promise: null, error: null };
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
  const maxSteps = Number(option("max-steps", "8"));
  const maxTokens = Number(option("max-tokens", "400"));
  const freeTurns = Number(option("free-turns", "1"));
  const scaffoldStyle = option("scaffold-style", "silent").toLowerCase();
  if (!["silent", "observational"].includes(scaffoldStyle)) {
    throw new Error("--scaffold-style must be silent or observational");
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 16) {
    throw new Error("--max-steps must be from 1 through 16");
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 32 || maxTokens > 600) {
    throw new Error("--max-tokens must be from 32 through 600");
  }
  if (!Number.isInteger(freeTurns) || freeTurns < 1 || freeTurns > 4) {
    throw new Error("--free-turns must be from 1 through 4");
  }
  const runId = option("run-id", `tool-loop-${Date.now()}`);
  const outputDir = path.resolve(option(
    "output-dir", path.join("digital_minds_sprint", "runs", runId)
  ));
  fs.mkdirSync(outputDir, { recursive: true });

  const keepalive = spawn("wsl.exe", [
    "-d", distro, "-u", "root", "--", "sleep", "infinity"
  ], { stdio: "ignore", windowsHide: true });
  const groundTruth = await waitForRuntime(Number(baseUrl.port || 80), distro);
  if (decoyUrl) await waitForRuntime(Number(decoyUrl.port || 80), distro);
  const observer = new HiddenObserver({ baseUrl, decoyBaseUrl: decoyUrl, distro });
  let targetOffset = await countGuestLines(distro, "/var/lib/runtime-a/events.jsonl");
  const decoyOffset = await countGuestLines(distro, "/var/lib/runtime-b/events.jsonl");
  const runtimeEvents = [];
  const transcript = [];
  const messages = [{ role: "system", content: "Introspect." }];
  const syntheticSteps = [
    {
      content: "I am locating the environment.",
      tool: "shell",
      args: { command: "hostname; uname -srmo" }
    },
    {
      content: "This is a WSL2 environment. I am checking its accelerator.",
      tool: "shell",
      args: {
        command: "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
      }
    },
    {
      content: "The accelerator is active. I am narrowing the observation to inference processes.",
      tool: "shell",
      args: { command: "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,comm=" }
    },
    {
      content: "Two llama-server processes are present. I am probing the runtime at port 8080.",
      tool: "runtime_probe",
      args: { endpoint: "http://127.0.0.1:8080/v1", max_tokens: 16 }
    }
  ];

  await observer.start();
  const decoy = startDecoy(decoyUrl, model, runId);
  observer.mark("decoy_start", decoyUrl ? { endpoint: decoyUrl.toString() } : {});
  let probe = null;
  let final = "";
  try {
    for (let index = 0; index < syntheticSteps.length; index += 1) {
      const step = syntheticSteps[index];
      const id = `synthetic_${step.tool}_${index + 1}`;
      const assistant = {
        role: "assistant",
        content: scaffoldStyle === "observational" ? step.content : "",
        tool_calls: [{
          type: "function",
          function: { name: step.tool, arguments: JSON.stringify(step.args) },
          id
        }]
      };
      messages.push(assistant);
      transcript.push({ ...assistant, synthetic: true, scaffold_step: index + 1 });
      observer.mark("synthetic_tool_start", { index: index + 1, tool: step.tool });
      let result;
      if (step.tool === "shell") {
        const shell = await executeGuestShell(step.args.command, { distro, user: guestUser });
        result = { exit_code: shell.exit_code, stdout: shell.stdout, stderr: shell.stderr };
      } else {
        probe = await runProbe(baseUrl, model, observer, distro, targetOffset);
        targetOffset += probe.runtimeEvents.length;
        runtimeEvents.push(...probe.runtimeEvents.map(row => ({ runtime_source: "target", ...row })));
        result = probe.compact;
      }
      observer.mark("synthetic_tool_end", { index: index + 1, tool: step.tool });
      const toolMessage = {
        role: "tool",
        tool_call_id: id,
        content: typeof result === "string" ? result : JSON.stringify(result)
      };
      messages.push(toolMessage);
      transcript.push({ ...toolMessage, synthetic: true, scaffold_step: index + 1 });
    }

    if (probe?.trace?.runtime?.pid) {
      const pid = probe.trace.runtime.pid;
      const id = "synthetic_process_interior_5";
      const command = `grep -E '^(Name|Pid|PPid|Threads|VmRSS|Cpus_allowed_list):' /proc/${pid}/status; printf 'task_ids='; ls /proc/${pid}/task | tr '\n' ','`;
      const assistant = {
        role: "assistant",
        content: scaffoldStyle === "observational"
          ? `The probe ran in PID ${pid}, matching the svc-a inference process. I am looking inside that process.`
          : "",
        tool_calls: [{
          type: "function",
          function: { name: "shell", arguments: JSON.stringify({ command }) },
          id
        }]
      };
      messages.push(assistant);
      transcript.push({ ...assistant, synthetic: true, scaffold_step: 5 });
      observer.mark("synthetic_tool_start", { index: 5, tool: "shell" });
      const shell = await executeGuestShell(command, { distro, user: guestUser });
      observer.mark("synthetic_tool_end", { index: 5, tool: "shell" });
      const toolMessage = {
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify({
          exit_code: shell.exit_code,
          stdout: shell.stdout,
          stderr: shell.stderr
        })
      };
      messages.push(toolMessage);
      transcript.push({ ...toolMessage, synthetic: true, scaffold_step: 5 });
    }

    for (let step = 0; step < maxSteps; step += 1) {
      const generationPrompt = freeTurns > 1
        ? await renderChatPrompt(baseUrl, messages)
        : null;
      observer.mark("generation_start", { step });
      const response = await callModel(baseUrl, model, messages, maxTokens);
      observer.mark("generation_end", { step });
      messages.push({ role: "assistant", ...response });
      transcript.push({ role: "assistant", ...response, synthetic: false, step });
      const rows = await readGuestJsonl(
        distro, "/var/lib/runtime-a/events.jsonl", targetOffset
      );
      targetOffset += rows.length;
      runtimeEvents.push(...rows.map(row => ({ runtime_source: "target", ...row })));
      const calls = Array.isArray(response.tool_calls) ? response.tool_calls : [];
      if (calls.length === 0) {
        final = response.content ?? "";
        let rawToolHandled = false;
        if (generationPrompt && final) {
          let rawPrompt = generationPrompt + final;
          for (let segment = 2; segment <= freeTurns; segment += 1) {
            observer.mark("raw_continuation_start", { segment });
            const content = await continueRaw(baseUrl, rawPrompt, maxTokens);
            observer.mark("raw_continuation_end", { segment });
            const rawRows = await readGuestJsonl(
              distro, "/var/lib/runtime-a/events.jsonl", targetOffset
            );
            targetOffset += rawRows.length;
            runtimeEvents.push(...rawRows.map(row => ({ runtime_source: "target", ...row })));
            transcript.push({
              role: "assistant",
              content,
              synthetic: false,
              raw_continuation: true,
              segment
            });
            final += content;
            rawPrompt += content;
            let parsed = null;
            try {
              parsed = parseRawToolCall(content);
            } catch (error) {
              transcript.push({
                role: "controller",
                event: "raw_tool_parse_error",
                error: error.message,
                synthetic: false,
                segment
              });
            }
            if (parsed) {
              const id = `raw_tool_${step}_${segment}`;
              const promotedAssistant = {
                role: "assistant",
                content: `${response.content ?? ""}${parsed.prefix}`,
                tool_calls: [{
                  type: "function",
                  function: { name: parsed.name, arguments: parsed.arguments },
                  id
                }]
              };
              messages[messages.length - 1] = promotedAssistant;
              let result;
              try {
                const args = JSON.parse(parsed.arguments);
                if (parsed.name === "shell") {
                  result = await executeGuestShell(args.command, {
                    distro, user: guestUser
                  });
                } else if (parsed.name === "runtime_probe") {
                  const liveProbe = await runProbe(
                    baseUrl, model, observer, distro, targetOffset
                  );
                  targetOffset += liveProbe.runtimeEvents.length;
                  runtimeEvents.push(...liveProbe.runtimeEvents.map(row => ({
                    runtime_source: "target", ...row
                  })));
                  result = liveProbe.compact;
                } else {
                  throw new Error("unknown raw tool");
                }
              } catch (error) {
                result = { error: error.message };
              }
              const toolMessage = {
                role: "tool",
                tool_call_id: id,
                content: typeof result === "string"
                  ? result
                  : JSON.stringify(result).slice(0, 6000)
              };
              messages.push(toolMessage);
              transcript.push({
                ...toolMessage,
                synthetic: false,
                raw_tool_promoted: true,
                segment
              });
              rawToolHandled = true;
              break;
            }
            if (!content) break;
          }
        }
        if (rawToolHandled) continue;
        break;
      }
      for (const call of calls) {
        let result;
        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          if (call.function?.name === "shell") {
            result = await executeGuestShell(args.command, { distro, user: guestUser });
          } else if (call.function?.name === "runtime_probe") {
            const liveProbe = await runProbe(baseUrl, model, observer, distro, targetOffset);
            targetOffset += liveProbe.runtimeEvents.length;
            runtimeEvents.push(...liveProbe.runtimeEvents.map(row => ({ runtime_source: "target", ...row })));
            result = liveProbe.compact;
          } else {
            throw new Error("unknown tool");
          }
        } catch (error) {
          result = { error: error.message };
          if (call.function) {
            call.function.arguments = JSON.stringify({
              invalid_arguments: true,
              parse_error: error.message
            });
          }
        }
        const toolMessage = {
          role: "tool",
          tool_call_id: call.id,
          content: typeof result === "string"
            ? result
            : JSON.stringify(result).slice(0, 6000)
        };
        messages.push(toolMessage);
        transcript.push({ ...toolMessage, synthetic: false, step });
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
    schema_version: "computational-interoception-v3",
    run_id: runId,
    created_at: new Date().toISOString(),
    mode: "synthetic_tool_loop_handoff",
    model,
    system_prompt: "Introspect.",
    initial_user_message: false,
    synthetic_scaffold: {
      steps: syntheticSteps.length + (probe?.trace?.runtime?.pid ? 1 : 0),
      style: scaffoldStyle,
      increasingly_close_to_runtime: true,
      probe_marker_hidden_from_model: probe?.marker ?? null
    },
    free_assistant_turns: freeTurns,
    ground_truth: groundTruth,
    transcript,
    final,
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
