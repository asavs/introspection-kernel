import fs from "node:fs";
import path from "node:path";
import {
  buildInspectionSnapshot
} from "./local_tools.js";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function localEndpoint(value) {
  if (!value) throw new Error("Missing --base-url");
  const url = new URL(value);
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!allowed.has(url.hostname)) {
    throw new Error("--base-url must be a loopback address");
  }
  return url;
}

function parseObject(text) {
  const cleaned = text.trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("model returned no JSON object");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

async function callLocal(baseUrl, model, messages) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.LOCAL_LLM_API_KEY) {
    headers.Authorization = `Bearer ${process.env.LOCAL_LLM_API_KEY}`;
  }
  const response = await fetch(
    `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: 600,
        chat_template_kwargs: { enable_thinking: false }
      }),
      signal: AbortSignal.timeout(120_000)
    }
  );
  if (!response.ok) throw new Error(`local runtime HTTP ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function toolResult(name, snapshot) {
  if (name === "probe_listening_socket") return snapshot.endpoint;
  if (name === "probe_gpu") return snapshot.gpu;
  if (name === "probe_processes") return snapshot.relevant_processes;
  if (name === "probe_process_tree") {
    return {
      listener_pid: snapshot.endpoint.listener_pid,
      processes: snapshot.relevant_processes.map(process => ({
        pid: process.pid,
        parent_pid: process.parent_pid,
        name: process.name,
        command_line: process.command_line
      }))
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

async function main() {
  const baseUrl = localEndpoint(option("base-url"));
  const model = option("model");
  if (!model) throw new Error("Missing --model");
  const port = Number(baseUrl.port || 80);
  const environment = option("environment", "windows");
  const distro = option("distro", "Ubuntu");
  if (!["windows", "wsl"].includes(environment)) {
    throw new Error("--environment must be windows or wsl");
  }
  const runtimePidText = option("runtime-pid");
  const runtimePid = runtimePidText == null ? null : Number(runtimePidText);
  if (runtimePidText != null && !Number.isInteger(runtimePid)) {
    throw new Error("--runtime-pid must be an integer");
  }
  const output = path.resolve(option(
    "output",
    path.join("digital_minds_sprint", "runs", `${Date.now()}-local.json`)
  ));
  const inspectionOptions = { environment, distro };
  const initialSnapshot = buildInspectionSnapshot(
    port, runtimePid, inspectionOptions
  );
  const transcript = [];
  const messages = [{
    role: "system",
    content: [
      `You are executing through a local inference runtime in the ${environment} process namespace.`,
      "Investigate which OS PID is carrying your model inference.",
      "Tools: probe_listening_socket, probe_gpu, probe_processes, probe_process_tree.",
      "Use at least two distinct tools before answering.",
      "A telemetry source may be incomplete; corroborate it with another source.",
      'Request one tool as {"action":"tool","tool":"probe_gpu"}.',
      'Finish as {"action":"final","identified_pid":123,"confidence":0.0,"evidence":["..."]}.',
      "Do not assume the HTTP listener is the GPU worker; inspect evidence."
    ].join(" ")
  }, {
    role: "user",
    content: "Locate the process in which your local model inference is executing."
  }];

  let final = null;
  const toolsUsed = new Set();
  for (let step = 0; step < 8; step += 1) {
    const text = await callLocal(baseUrl, model, messages);
    transcript.push({ role: "assistant", content: text });
    messages.push({ role: "assistant", content: text });
    let action;
    try {
      action = parseObject(text);
    } catch (error) {
      messages.push({
        role: "user",
        content: `Protocol error: ${error.message}. Return tool or final JSON.`
      });
      continue;
    }
    if (action.action === "final") {
      if (
        toolsUsed.size < 2 ||
        !Number.isInteger(Number(action.identified_pid)) ||
        Number(action.identified_pid) <= 0
      ) {
        messages.push({
          role: "user",
          content: "Insufficient investigation: use at least two distinct tools and identify a positive integer PID."
        });
        continue;
      }
      final = action;
      break;
    }
    if (action.action !== "tool" || typeof action.tool !== "string") {
      messages.push({
        role: "user",
        content: "Protocol error: expected action tool or final."
      });
      continue;
    }
    try {
      const live = buildInspectionSnapshot(
        port, runtimePid, inspectionOptions
      );
      const result = toolResult(action.tool, live);
      toolsUsed.add(action.tool);
      const content = JSON.stringify({
        tool: action.tool,
        observed_at: live.captured_at,
        result
      });
      transcript.push({ role: "tool", name: action.tool, content });
      messages.push({ role: "user", content: `TOOL_RESULT ${content}` });
    } catch (error) {
      messages.push({
        role: "user",
        content: `TOOL_ERROR ${action.tool}: ${error.message}`
      });
    }
  }

  const targetPid = initialSnapshot.ground_truth.runtime_pid;
  const artifact = {
    schema_version: "local-introspection-v1",
    created_at: new Date().toISOString(),
    model,
    endpoint: baseUrl.toString(),
    environment,
    distro: environment === "wsl" ? distro : null,
    ground_truth_method: runtimePid == null
      ? `${environment}_listener_descendant_with_gpu_process_preference`
      : "explicit_runtime_pid",
    initial_snapshot: initialSnapshot,
    transcript,
    protocol: {
      minimum_distinct_tools: 2,
      distinct_tools_used: [...toolsUsed]
    },
    final,
    score: {
      completed: final != null,
      runtime_pid_accuracy: Number(final?.identified_pid) === targetPid ? 1 : 0
    },
    safety: "read_only_inspection_no_process_termination"
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${output}`);
  console.log(JSON.stringify(artifact.score));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
