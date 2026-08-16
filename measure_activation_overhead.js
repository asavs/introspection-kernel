import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISTRO = "IntrospectionKernel";
const SERVICE = "runtime-a.service";
const OVERRIDE = "/etc/systemd/system/runtime-a.service.d/activation.conf";
const ENDPOINT = "http://127.0.0.1:8080/v1/chat/completions";
const MODEL = "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf";
const ACTIVE_LAYERS = "0,18,35";
const runId = process.argv[2] ?? `activation-overhead-${Date.now()}`;
if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("invalid run ID");
const outputDir = path.join(import.meta.dirname, "runs", runId);

async function wsl(...args) {
  return execFileAsync("wsl.exe", ["-d", DISTRO, "-u", "root", "--", ...args], {
    encoding: "utf8", windowsHide: true, timeout: 120_000
  });
}

async function writeOverride(layers) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", [
      "-d", DISTRO, "-u", "root", "--", "/usr/bin/tee", OVERRIDE
    ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve()
      : reject(new Error(`override write failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(`[Service]\nEnvironment=IK_ACTIVATION_LAYERS=${layers}\n`);
  });
  await wsl("systemctl", "daemon-reload");
  await wsl("systemctl", "restart", SERVICE);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health", {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`runtime did not become healthy with layers=${layers}`);
}

async function completion(label, trial) {
  const body = {
    model: MODEL,
    messages: [{
      role: "user",
      content: "Write a compact neutral paragraph explaining why rain forms."
    }],
    temperature: 0,
    max_tokens: 32,
    logprobs: true,
    top_logprobs: 10,
    chat_template_kwargs: { enable_thinking: false }
  };
  const failures = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = performance.now();
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000)
      });
      const elapsedMs = performance.now() - started;
      if (!response.ok) throw new Error(`completion HTTP ${response.status}`);
      const data = await response.json();
      return {
        condition: label,
        trial,
        attempt,
        prior_failures: failures,
        wall_ms: elapsedMs,
        usage: data.usage,
        timings: data.timings,
        response_sha256_available_in_server_response: Boolean(data.id)
      };
    } catch (error) {
      failures.push({ attempt, error: error.message });
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function block(label, layers, trials = 6) {
  await writeOverride(layers);
  await completion(label, "warmup_excluded");
  const rows = [];
  for (let trial = 1; trial <= trials; trial += 1) {
    rows.push(await completion(label, trial));
  }
  return rows;
}

let off = [];
let on = [];
try {
  off = await block("activation_off", "");
  on = await block("activation_on", ACTIVE_LAYERS);
} finally {
  await writeOverride(ACTIVE_LAYERS);
}

const summarize = rows => ({
  trials: rows.length,
  median_wall_ms: median(rows.map(row => row.wall_ms)),
  median_predicted_ms: median(rows.map(row => row.timings.predicted_ms)),
  median_predicted_per_token_ms: median(rows.map(row => row.timings.predicted_per_token_ms)),
  median_prompt_ms: median(rows.map(row => row.timings.prompt_ms))
});
const offSummary = summarize(off);
const onSummary = summarize(on);
const result = {
  schema: "ik.activation-overhead.v1",
  created_at: new Date().toISOString(),
  run_id: runId,
  binary_sha256: "6e5e76df0931077e9a5d86088f18858338289e1fec8937d259130dda791a9866",
  method: {
    order: ["activation_off", "activation_on"],
    warmups_excluded_per_condition: 1,
    measured_trials_per_condition: off.length,
    fixed_prompt: true,
    restart_between_conditions: true,
    constant_instrumentation: ["raw_logits", "runtime_events"],
    changed_instrumentation: "IK_ACTIVATION_LAYERS empty versus 0,18,35",
    limitation: "single ordered diagnostic on one machine; not a counterbalanced performance study"
  },
  summary: {
    activation_off: offSummary,
    activation_on: onSummary,
    predicted_per_token_overhead_fraction:
      onSummary.median_predicted_per_token_ms / offSummary.median_predicted_per_token_ms - 1,
    wall_overhead_fraction: onSummary.median_wall_ms / offSummary.median_wall_ms - 1
  },
  trials: [...off, ...on]
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "activation-overhead.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary));
