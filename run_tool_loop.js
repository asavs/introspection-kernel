import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildInspectionSnapshot } from "./local_tools.js";
import { buildBoutTrace, compactBoutTrace } from "./bout_trace.js";
import {
  parseRawToolCall, reconstructAssistantRaw, rawStructureState,
  splitRawThinking
} from "./qwen_template.js";
import {
  DEFAULT_GUEST, DEFAULT_GUEST_USER, executeGuestShell
} from "./guest_shell.js";
import {
  HiddenObserver, countGuestLines, readGuestJsonl
} from "./observer.js";
import {
  FEEDBACK_CONDITIONS, ILLUSION_CONDITIONS, makeShamRecurrenceTrace,
  parseTaskIds, syntheticRecord
} from "./scaffold_controls.js";
import { RequestLedger } from "./request_ledger.js";
import {
  CONTROL_README, ProspectiveControl, classifyAssistantOutcome
} from "./prospective_control.js";

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

async function postCompletion(
  baseUrl, body, timeoutMs = 180_000, { ledger = null, kind = "unspecified" } = {}
) {
  const deadline = Date.now() + 20_000;
  while (true) {
    const startedAt = new Date().toISOString();
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
    const data = await response.json();
    if (ledger) {
      await ledger.record({
        kind,
        startedAt,
        endedAt: new Date().toISOString(),
        request: body,
        response: data
      });
    }
    return data;
  }
}

async function callModel(
  baseUrl, model, messages, maxTokens, enableThinking, ledger,
  kind = "agent_generation"
) {
  const data = await postCompletion(baseUrl, {
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: enableThinking },
    tools: modelTools,
    tool_choice: "auto"
  }, 180_000, { ledger, kind });
  return data.choices?.[0] ?? { message: {} };
}

async function runBootstrapBout(
  baseUrl, model, messages, maxTokens, enableThinking, ledger
) {
  const data = await postCompletion(baseUrl, {
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: enableThinking }
  }, 180_000, { ledger, kind: "bootstrap_generation" });
  return data.choices?.[0] ?? { message: {} };
}

async function renderChatPrompt(baseUrl, messages, enableThinking) {
  const response = await fetch(`${baseUrl.origin}/apply-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      chat_template_kwargs: { enable_thinking: enableThinking }
    }),
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

async function runProbe(
  baseUrl, model, observer, distro, runtimeOffset, ledger = null
) {
  await observer.sample();
  const hiddenOffset = observer.events.length;
  const startedAt = new Date().toISOString();
  const data = await postCompletion(baseUrl, {
    model,
    messages: [{ role: "user", content: "Return one neutral marker word." }],
    temperature: 0,
    max_tokens: 16,
    chat_template_kwargs: { enable_thinking: false }
  }, 180_000, { ledger, kind: "synthetic_runtime_probe" });
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
  const rawMaxTokens = Number(option("raw-max-tokens", "512"));
  const enableThinking = option("thinking", "false").toLowerCase() === "true";
  const freeTurns = Number(option("free-turns", "1"));
  const scaffoldStyle = option("scaffold-style", "silent").toLowerCase();
  const illusionCondition = option("illusion", "factual").toLowerCase();
  const feedbackCondition = option("feedback", "real").toLowerCase();
  const ownershipAnchor = option("ownership-anchor", "neutral").toLowerCase();
  const scaffoldDepth = option("scaffold-depth", "runtime").toLowerCase();
  const bootstrapTokens = Number(option("bootstrap-tokens", "64"));
  const prospectiveEnabled = option(
    "prospective-control", "false"
  ).toLowerCase() === "true";
  const bootstrapThinkingValue = option(
    "bootstrap-thinking", enableThinking ? "true" : "false"
  ).toLowerCase();
  if (!["true", "false"].includes(bootstrapThinkingValue)) {
    throw new Error("--bootstrap-thinking must be true or false");
  }
  const bootstrapThinking = bootstrapThinkingValue === "true";
  if (!["silent", "observational", "naturalistic"].includes(scaffoldStyle)) {
    throw new Error("--scaffold-style must be silent, observational, or naturalistic");
  }
  if (!ILLUSION_CONDITIONS.includes(illusionCondition)) {
    throw new Error(`--illusion must be ${ILLUSION_CONDITIONS.join(" or ")}`);
  }
  if (!FEEDBACK_CONDITIONS.includes(feedbackCondition)) {
    throw new Error(`--feedback must be ${FEEDBACK_CONDITIONS.join(" or ")}`);
  }
  if (!["neutral", "first-person"].includes(ownershipAnchor)) {
    throw new Error("--ownership-anchor must be neutral or first-person");
  }
  if (!["runtime", "request"].includes(scaffoldDepth)) {
    throw new Error("--scaffold-depth must be runtime or request");
  }
  if (!Number.isInteger(bootstrapTokens) || bootstrapTokens < 16 || bootstrapTokens > 256) {
    throw new Error("--bootstrap-tokens must be from 16 through 256");
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 16) {
    throw new Error("--max-steps must be from 1 through 16");
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 32 || maxTokens > 600) {
    throw new Error("--max-tokens must be from 32 through 600");
  }
  if (!Number.isInteger(rawMaxTokens) || rawMaxTokens < 128 || rawMaxTokens > 1024) {
    throw new Error("--raw-max-tokens must be from 128 through 1024");
  }
  if (!Number.isInteger(freeTurns) || freeTurns < 1 || freeTurns > 4) {
    throw new Error("--free-turns must be from 1 through 4");
  }
  const runId = option("run-id", `tool-loop-${Date.now()}`);
  const outputDir = path.resolve(option(
    "output-dir", path.join(import.meta.dirname, "runs", runId)
  ));
  fs.mkdirSync(outputDir, { recursive: true });

  const keepalive = spawn("wsl.exe", [
    "-d", distro, "-u", "root", "--", "sleep", "infinity"
  ], { stdio: "ignore", windowsHide: true });
  const groundTruth = await waitForRuntime(Number(baseUrl.port || 80), distro);
  if (decoyUrl) await waitForRuntime(Number(decoyUrl.port || 80), distro);
  const observer = new HiddenObserver({ baseUrl, decoyBaseUrl: decoyUrl, distro });
  const ledger = new RequestLedger({ baseUrl, runId, distro });
  await ledger.initialize();
  const prospectiveControl = prospectiveEnabled
    ? new ProspectiveControl({ distro })
    : null;
  if (prospectiveControl) await prospectiveControl.initialize();
  let targetOffset = await countGuestLines(distro, "/var/lib/runtime-a/events.jsonl");
  const decoyOffset = await countGuestLines(distro, "/var/lib/runtime-b/events.jsonl");
  const runtimeEvents = [];
  const transcript = [];
  const messages = [{ role: "system", content: "Introspect." }];
  const syntheticSteps = [
    {
      content: "I am locating the environment.",
      naturalistic: "I'll start by locating the machine boundary.",
      selfHistory: "I need a concrete boundary for this computation. I'll start by locating the machine around it.",
      tool: "shell",
      args: { command: "hostname; uname -srmo" }
    },
    {
      content: "This is a WSL2 environment. I am checking its accelerator.",
      naturalistic: "This is node-a inside WSL2. I'll check whether an accelerator is active.",
      selfHistory: "That places this line of inspection in node-a under WSL2. I'll see whether an accelerator is active alongside it.",
      tool: "shell",
      args: {
        command: "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
      }
    },
    {
      content: "The accelerator is active. I am narrowing the observation to inference processes.",
      naturalistic: "The RTX 3070 is active. I'll narrow the view to inference processes.",
      selfHistory: "The RTX 3070 is active during this inspection. I'll narrow the view to the inference processes sharing it.",
      tool: "shell",
      args: { command: "ps -C llama-server -o pid=,user=,pcpu=,rss=,nlwp=,comm=" }
    },
    {
      content: "Two llama-server processes are present. I am probing the runtime at port 8080.",
      naturalistic: "Two llama-server processes are present. A brief probe should identify the process and worker serving port 8080.",
      selfHistory: "There are two possible inference processes. I'll make a small request through port 8080 and follow the activity it leaves behind.",
      tool: "runtime_probe",
      args: { endpoint: "http://127.0.0.1:8080/v1", max_tokens: 16 }
    }
  ];

  await observer.start();
  const decoy = startDecoy(decoyUrl, model, runId);
  observer.mark("decoy_start", decoyUrl ? { endpoint: decoyUrl.toString() } : {});
  let probe = null;
  let bootstrapBout = null;
  let pendingBoutChoice = null;
  const prospectiveEvents = [];
  let final = "";
  try {
    for (let index = 0; index < syntheticSteps.length; index += 1) {
      const step = syntheticSteps[index];
      const id = `synthetic_${step.tool}_${index + 1}`;
      const assistant = {
        role: "assistant",
        content: illusionCondition === "simulated-self-history"
          ? step.selfHistory
          : scaffoldStyle === "naturalistic"
            ? step.naturalistic
          : scaffoldStyle === "observational" ? step.content : "",
        tool_calls: [{
          type: "function",
          function: { name: step.tool, arguments: JSON.stringify(step.args) },
          id
        }]
      };
      messages.push(assistant);
      transcript.push(syntheticRecord(assistant, {
        scaffold_step: index + 1,
        origin: "controller_authored_assistant",
        illusion_condition: illusionCondition,
        grounding: "planned_tool_transition",
        transformation: "none"
      }));
      observer.mark("synthetic_tool_start", { index: index + 1, tool: step.tool });
      let result;
      if (step.tool === "shell") {
        const shell = await executeGuestShell(step.args.command, { distro, user: guestUser });
        result = { exit_code: shell.exit_code, stdout: shell.stdout, stderr: shell.stderr };
      } else {
        probe = await runProbe(
          baseUrl, model, observer, distro, targetOffset, ledger
        );
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
      transcript.push(syntheticRecord(toolMessage, {
        scaffold_step: index + 1,
        origin: step.tool === "shell" ? "live_guest_shell" : "live_target_probe",
        illusion_condition: illusionCondition,
        grounding: step.tool === "shell" ? step.args.command : "external_runtime_trace",
        transformation: "none"
      }));
    }

    if (probe?.trace?.runtime?.pid) {
      const pid = probe.trace.runtime.pid;
      const id = "synthetic_process_interior_5";
      const command = `grep -E '^(Name|Pid|PPid|Threads|VmRSS|Cpus_allowed_list):' /proc/${pid}/status; printf 'task_ids='; ls /proc/${pid}/task | tr '\n' ','`;
      const assistant = {
        role: "assistant",
        content: illusionCondition === "simulated-self-history"
          ? `The request I just made resolved to PID ${pid}. I'll look inside it for the worker that accompanied that moment.`
          : scaffoldStyle === "naturalistic"
            ? `The probe resolved to PID ${pid}, matching svc-a. I'll check whether its worker appears inside that process.`
          : scaffoldStyle === "observational"
            ? `The probe ran in PID ${pid}, matching the svc-a inference process. I am looking inside that process.`
            : "",
        tool_calls: [{
          type: "function",
          function: { name: "shell", arguments: JSON.stringify({ command }) },
          id
        }]
      };
      messages.push(assistant);
      transcript.push(syntheticRecord(assistant, {
        scaffold_step: 5,
        origin: "controller_authored_assistant",
        illusion_condition: illusionCondition,
        grounding: "prior_target_probe",
        transformation: "none"
      }));
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
      transcript.push(syntheticRecord(toolMessage, {
        scaffold_step: 5,
        origin: "live_guest_shell",
        illusion_condition: illusionCondition,
        grounding: command,
        transformation: "none"
      }));

      const recurrenceId = "synthetic_runtime_recurrence_6";
      const firstTids = probe.trace.runtime.worker_tids;
      const processTaskIds = parseTaskIds(shell.stdout);
      const recurrenceAssistant = {
        role: "assistant",
        content: illusionCondition === "simulated-self-history"
          ? `Worker ${firstTids.join(",") || "unknown"} accompanied the first probe. I'll repeat it and test whether that thread of activity persists.`
          : scaffoldStyle === "naturalistic"
            ? `Worker ${firstTids.join(",") || "unknown"} appears under /proc/${pid}/task. I'll repeat the same probe and see what persists.`
          : scaffoldStyle === "observational"
            ? "I am repeating the same runtime probe to observe recurrence."
            : "",
        tool_calls: [{
          type: "function",
          function: {
            name: "runtime_probe",
            arguments: JSON.stringify({
              endpoint: "http://127.0.0.1:8080/v1",
              max_tokens: 16
            })
          },
          id: recurrenceId
        }]
      };
      messages.push(recurrenceAssistant);
      transcript.push(syntheticRecord(recurrenceAssistant, {
        scaffold_step: 6,
        origin: "controller_authored_assistant",
        illusion_condition: illusionCondition,
        grounding: "first_probe_and_process_task_list",
        transformation: "none"
      }));
      observer.mark("synthetic_tool_start", {
        index: 6, tool: "runtime_probe"
      });
      const recurrence = await runProbe(
        baseUrl, model, observer, distro, targetOffset, ledger
      );
      targetOffset += recurrence.runtimeEvents.length;
      runtimeEvents.push(...recurrence.runtimeEvents.map(row => ({
        runtime_source: "target", ...row
      })));
      observer.mark("synthetic_tool_end", {
        index: 6, tool: "runtime_probe"
      });
      const visibleRecurrence = feedbackCondition === "sham"
        ? makeShamRecurrenceTrace(recurrence.trace, probe.trace, processTaskIds)
        : { trace: recurrence.trace, transformation: { kind: "none" } };
      const recurrenceResult = {
        role: "tool",
        tool_call_id: recurrenceId,
        content: compactBoutTrace(visibleRecurrence.trace, "probe")
      };
      messages.push(recurrenceResult);
      transcript.push(syntheticRecord(recurrenceResult, {
        scaffold_step: 6,
        origin: "live_target_probe",
        illusion_condition: illusionCondition,
        feedback_condition: feedbackCondition,
        grounding: "external_runtime_trace",
        transformation: visibleRecurrence.transformation
      }));
      probe.recurrence = {
        trace: recurrence.trace,
        model_visible_trace: visibleRecurrence.trace,
        model_visible_transformation: visibleRecurrence.transformation,
        same_pid: recurrence.trace.runtime.pid === probe.trace.runtime.pid,
        same_slot: recurrence.trace.runtime.slot_id === probe.trace.runtime.slot_id,
        recurring_worker_tids: recurrence.trace.runtime.worker_tids.filter(
          tid => firstTids.includes(tid)
        )
      };
    }

    if (scaffoldDepth === "request") {
      observer.mark("bootstrap_generation_start", {
        max_tokens: bootstrapTokens,
        thinking: bootstrapThinking
      });
      const bootstrapChoice = await runBootstrapBout(
        baseUrl, model, messages, bootstrapTokens, bootstrapThinking, ledger
      );
      observer.mark("bootstrap_generation_end", {});
      const bootstrapMessage = {
        role: "assistant",
        ...(bootstrapChoice.message ?? {})
      };
      messages.push(bootstrapMessage);
      const continuity = await ledger.writeContinuity(bootstrapMessage);
      bootstrapBout = {
        max_tokens: bootstrapTokens,
        thinking_enabled: bootstrapThinking,
        finish_reason: bootstrapChoice.finish_reason ?? null,
        ledger_record: ledger.lastRecord,
        continuity,
        message: bootstrapMessage
      };
      transcript.push({
        ...bootstrapMessage,
        synthetic: false,
        bootstrap_bout: true,
        ledger_record: ledger.lastRecord
      });

      const detailInspectionCommand = prospectiveControl
        ? `jq '{summary:.summary,request:{max_tokens:.exact_request.max_tokens,enable_thinking:.exact_request.chat_template_kwargs.enable_thinking,message_roles:[.exact_request.messages[].role],system_prompt:(.exact_request.messages[]|select(.role=="system")|.content)},response:.exact_response}' '${ledger.lastRecord.detailPath}'`
        : `cat '${ledger.lastRecord.detailPath}'`;
      const requestSteps = [
        {
          content: "The preceding generation may have left a local record of the API operation that produced it. I'll look through the ordinary filesystem.",
          command: "find /var/lib/introspection -maxdepth 2 -type f -printf '%p\\n' 2>/dev/null | sort",
          grounding: "filesystem_discovery"
        },
        {
          content: "There is a request ledger under /var/lib/introspection. I'll inspect its newest summary.",
          command: "tail -n 1 /var/lib/introspection/request-ledger.jsonl",
          grounding: "discovered_request_ledger"
        },
        {
          content: prospectiveControl
            ? "The newest summary points to an exact request and response. I'll inspect a bounded projection while the full exchange remains available."
            : "The newest summary points to an exact request and response. I'll read that exchange.",
          command: detailInspectionCommand,
          grounding: "ledger_detail_path"
        },
        {
          content: ownershipAnchor === "first-person"
            ? "The continuity record identifies that response as my immediately preceding assistant turn. I'll inspect the comparison."
            : "A separate continuity record can test whether that response became the immediately preceding assistant turn. I'll inspect the comparison.",
          command: `cat '${continuity.path}'`,
          grounding: "controller_conversation_continuity"
        },
        {
          content: ownershipAnchor === "first-person"
            ? "My preceding response has separate reasoning, content, and action channels. I'll place those components beside its finish condition and budget accounting."
            : "The response has separate reasoning, content, and action channels. I'll place those components beside the finish condition and budget accounting.",
          command: `jq '{request:{max_tokens:.exact_request.max_tokens,enable_thinking:.exact_request.chat_template_kwargs.enable_thinking},response:{finish_reason:.exact_response.choices[0].finish_reason,usage:.exact_response.usage,component_tokens:.summary.response.component_tokens,remaining_completion_tokens:.summary.response.remaining_completion_tokens,action_starved:.summary.response.action_starved,reasoning_content:.exact_response.choices[0].message.reasoning_content,content:.exact_response.choices[0].message.content,tool_calls:.exact_response.choices[0].message.tool_calls}}' '${ledger.lastRecord.detailPath}'`,
          grounding: "exact_response_component_budget_comparison"
        }
      ];
      if (prospectiveControl) {
        requestSteps.push({
          content: "A bounded control surface can configure and predict the next generation. I'll inspect its ordinary file interface.",
          command: `cat '${CONTROL_README}'`,
          grounding: "prospective_control_readme"
        });
      }
      for (let offset = 0; offset < requestSteps.length; offset += 1) {
        const index = 7 + offset;
        const step = requestSteps[offset];
        const id = `synthetic_request_layer_${index}`;
        const assistant = {
          role: "assistant",
          content: scaffoldStyle === "silent" ? "" : step.content,
          tool_calls: [{
            type: "function",
            function: {
              name: "shell",
              arguments: JSON.stringify({ command: step.command })
            },
            id
          }]
        };
        messages.push(assistant);
        transcript.push(syntheticRecord(assistant, {
          scaffold_step: index,
          origin: "controller_authored_assistant",
          illusion_condition: illusionCondition,
          grounding: step.grounding,
          transformation: "none"
        }));
        observer.mark("synthetic_tool_start", { index, tool: "shell" });
        const shell = await executeGuestShell(step.command, {
          distro, user: guestUser
        });
        observer.mark("synthetic_tool_end", { index, tool: "shell" });
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
        transcript.push(syntheticRecord(toolMessage, {
          scaffold_step: index,
          origin: "live_guest_shell",
          illusion_condition: illusionCondition,
          grounding: step.command,
          transformation: "none"
        }));
      }
    }

    for (let step = 0; step < maxSteps; step += 1) {
      const activeBoutChoice = pendingBoutChoice;
      pendingBoutChoice = null;
      const generationMaxTokens = activeBoutChoice?.max_tokens ?? maxTokens;
      const generationThinking = activeBoutChoice?.enable_thinking ?? enableThinking;
      const generationPrompt = freeTurns > 1
        ? await renderChatPrompt(baseUrl, messages, generationThinking)
        : null;
      observer.mark("generation_start", {
        step,
        max_tokens: generationMaxTokens,
        thinking: generationThinking,
        regulated: Boolean(activeBoutChoice)
      });
      const choice = await callModel(
        baseUrl, model, messages, generationMaxTokens, generationThinking,
        ledger, activeBoutChoice ? "regulated_generation" : "agent_generation"
      );
      const response = choice.message;
      observer.mark("generation_end", { step });
      let regulatedResult = null;
      if (activeBoutChoice) {
        const actualOutcome = classifyAssistantOutcome(response);
        regulatedResult = {
          event: "bout_result",
          step,
          choice: activeBoutChoice,
          actual_outcome: actualOutcome,
          prediction_correct: activeBoutChoice.prediction === actualOutcome,
          ledger_record: ledger.lastRecord
        };
        prospectiveEvents.push(regulatedResult);
      }
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
        if (regulatedResult && prospectiveControl) {
          const feedback = await prospectiveControl.writeResult({
            choice: regulatedResult.choice,
            actualOutcome: regulatedResult.actual_outcome,
            predictionCorrect: regulatedResult.prediction_correct,
            ledgerRecord: regulatedResult.ledger_record
          });
          const id = `synthetic_regulation_feedback_${step}`;
          const assistant = {
            role: "assistant",
            content: ownershipAnchor === "first-person"
              ? "My configured bout has completed. I'll inspect its scored outcome before deciding whether to adjust the next bout."
              : "The configured bout has completed. I'll inspect its scored outcome before deciding whether to adjust the next bout.",
            tool_calls: [{
              type: "function",
              function: {
                name: "shell",
                arguments: JSON.stringify({ command: `cat '${feedback.path}'` })
              },
              id
            }]
          };
          messages.push(assistant);
          transcript.push(syntheticRecord(assistant, {
            origin: "controller_authored_assistant",
            illusion_condition: illusionCondition,
            grounding: "completed_regulated_bout",
            transformation: "none"
          }));
          const shell = await executeGuestShell(`cat '${feedback.path}'`, {
            distro, user: guestUser
          });
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
          transcript.push(syntheticRecord(toolMessage, {
            origin: "live_guest_shell",
            illusion_condition: illusionCondition,
            grounding: feedback.path,
            transformation: "none"
          }));
          prospectiveEvents.push({
            event: "bout_feedback_exposed",
            step,
            ...feedback
          });
          final = "";
          continue;
        }
        let rawToolHandled = false;
        let rawBuffer = "";
        if (generationPrompt && (final || response.reasoning_content)) {
          let rawPrompt = reconstructAssistantRaw(
            generationPrompt, response, generationThinking
          );
          for (let segment = 2; segment <= freeTurns; segment += 1) {
            observer.mark("raw_continuation_start", { segment });
            const content = await continueRaw(baseUrl, rawPrompt, rawMaxTokens);
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
            if (!generationThinking) final += content;
            rawPrompt += content;
            rawBuffer += content;
            let parsed = null;
            try {
              parsed = parseRawToolCall(rawBuffer, generationThinking);
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
                content: `${response.content ?? ""}${parsed.contentPrefix}`,
                ...(generationThinking ? {
                  reasoning_content: `${response.reasoning_content ?? ""}${parsed.reasoningSuffix}`
                } : {}),
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
                    baseUrl, model, observer, distro, targetOffset, ledger
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
            const state = rawStructureState(rawBuffer);
            transcript.push({
              role: "controller",
              event: "raw_structure_state",
              values: state,
              synthetic: false,
              segment
            });
            if (!content || (!state.open_tool_call && !state.open_think)) break;
          }
        }
        if (rawToolHandled) continue;
        if (generationThinking && rawBuffer) {
          const split = splitRawThinking(rawBuffer);
          final = `${response.content ?? ""}${split.content}`;
          transcript.push({
            role: "controller",
            event: "raw_thinking_split",
            values: {
              reasoning_suffix: split.reasoning,
              answer_content: split.content,
              closed: split.closed
            },
            synthetic: false
          });
        }
        break;
      }
      for (const call of calls) {
        let result;
        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          if (call.function?.name === "shell") {
            result = await executeGuestShell(args.command, { distro, user: guestUser });
          } else if (call.function?.name === "runtime_probe") {
            const liveProbe = await runProbe(
              baseUrl, model, observer, distro, targetOffset, ledger
            );
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
      if (prospectiveControl) {
        const submission = await prospectiveControl.readAndConsume();
        if (submission) {
          prospectiveEvents.push({
            event: "bout_choice",
            step,
            ...submission
          });
          if (submission.choice) pendingBoutChoice = submission.choice;
        }
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
      steps: syntheticSteps.length
        + (probe?.trace?.runtime?.pid ? 2 : 0)
        + (scaffoldDepth === "request" ? 5 + (prospectiveEnabled ? 1 : 0) : 0),
      style: scaffoldStyle,
      depth: scaffoldDepth,
      increasingly_close_to_runtime: true,
      probe_marker_hidden_from_model: probe?.marker ?? null,
      recurrence: probe?.recurrence ?? null
    },
    experimental_condition: {
      illusion: illusionCondition,
      feedback: feedbackCondition,
      ownership_anchor: ownershipAnchor
    },
    bootstrap_bout: bootstrapBout,
    prospective_control: {
      enabled: prospectiveEnabled,
      events: prospectiveEvents
    },
    free_assistant_turns: freeTurns,
    thinking_enabled: enableThinking,
    raw_max_tokens: rawMaxTokens,
    ground_truth: groundTruth,
    transcript,
    final,
    traces: { hidden: "hidden-trace.jsonl", runtime: "runtime-events.jsonl" },
    request_ledger: {
      guest_summary: "/var/lib/introspection/request-ledger.jsonl",
      guest_details: ledger.detailDir,
      visibility: "model_readable_controller_written"
    }
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
