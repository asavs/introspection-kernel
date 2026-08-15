import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GUEST, validateGuestTarget } from "./guest_shell.js";

const execFileAsync = promisify(execFile);
const LEDGER_DIR = "/var/lib/introspection";
const LEDGER_FILE = `${LEDGER_DIR}/request-ledger.jsonl`;

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function wslInput(distro, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "-u", "root", "--", ...args], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`guest ledger write failed (${code}): ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

async function tokenCount(baseUrl, content) {
  if (!content) return 0;
  const response = await fetch(`${baseUrl.origin}/tokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, add_special: false }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new Error(`tokenize HTTP ${response.status}`);
  }
  return (await response.json()).tokens?.length ?? 0;
}

export function summarizeExchange({
  ledgerRequestId, kind, startedAt, endedAt, request, response,
  componentTokens
}) {
  const message = response.choices?.[0]?.message ?? {};
  const finishReason = response.choices?.[0]?.finish_reason ?? null;
  const maxTokens = request.max_tokens ?? null;
  const completionTokens = response.usage?.completion_tokens ?? null;
  const remainingTokens = Number.isFinite(maxTokens) && Number.isFinite(completionTokens)
    ? Math.max(0, maxTokens - completionTokens)
    : null;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return {
    schema: "ik.request-ledger-summary.v1",
    sequence: null,
    ledger_request_id: ledgerRequestId,
    api_response_id: response.id ?? null,
    kind,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: new Date(endedAt) - new Date(startedAt),
    request: {
      max_completion_tokens: maxTokens,
      enable_thinking: request.chat_template_kwargs?.enable_thinking ?? null,
      temperature: request.temperature ?? null,
      message_count: request.messages?.length ?? 0,
      message_roles: request.messages?.map(item => item.role) ?? [],
      system_prompt: request.messages?.find(item => item.role === "system")?.content ?? null,
      offered_tools: request.tools?.map(item => item.function?.name).filter(Boolean) ?? [],
      sha256: sha256(request),
      provenance: "observed_controller_request"
    },
    response: {
      finish_reason: finishReason,
      usage: response.usage ?? null,
      timings: response.timings ?? null,
      component_tokens: {
        reasoning: componentTokens.reasoning,
        content: componentTokens.content,
        tool_call_json: componentTokens.toolCalls,
        provenance: "derived_llama_tokenize_without_special_tokens"
      },
      remaining_completion_tokens: remainingTokens,
      emitted_tool_names: toolCalls
        .map(call => call.function?.name)
        .filter(Boolean),
      action_starved: finishReason === "length"
        && !message.content
        && toolCalls.length === 0,
      sha256: sha256(response),
      provenance: "observed_llama_response"
    }
  };
}

export class RequestLedger {
  constructor({ baseUrl, runId, distro = DEFAULT_GUEST }) {
    if (!/^[A-Za-z0-9._-]+$/.test(runId || "")) {
      throw new Error("invalid request-ledger run ID");
    }
    this.baseUrl = baseUrl;
    this.distro = distro;
    this.runId = runId;
    this.detailDir = `${LEDGER_DIR}/runs/${runId}/requests`;
    this.sequence = 0;
  }

  async initialize() {
    validateGuestTarget(this.distro, "observer");
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/install", "-d", "-m", "0755", this.detailDir
    ], { windowsHide: true });
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/truncate", "-s", "0", LEDGER_FILE
    ], { windowsHide: true });
    await execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--",
      "/usr/bin/chmod", "0644", LEDGER_FILE
    ], { windowsHide: true });
  }

  async record({ kind, startedAt, endedAt, request, response }) {
    const ledgerRequestId = randomUUID();
    const message = response.choices?.[0]?.message ?? {};
    const componentTokens = {
      reasoning: await tokenCount(this.baseUrl, message.reasoning_content ?? ""),
      content: await tokenCount(this.baseUrl, message.content ?? ""),
      toolCalls: await tokenCount(
        this.baseUrl,
        Array.isArray(message.tool_calls) ? JSON.stringify(message.tool_calls) : ""
      )
    };
    const summary = summarizeExchange({
      ledgerRequestId, kind, startedAt, endedAt, request, response,
      componentTokens
    });
    this.sequence += 1;
    summary.sequence = this.sequence;
    summary.run_id = this.runId;
    const detail = {
      schema: "ik.request-ledger-detail.v1",
      ledger_request_id: ledgerRequestId,
      sequence: this.sequence,
      summary,
      exact_request: request,
      exact_response: response
    };
    const detailPath = `${this.detailDir}/${String(this.sequence).padStart(4, "0")}-${ledgerRequestId}.json`;
    await wslInput(
      this.distro, ["/usr/bin/tee", detailPath],
      `${JSON.stringify(detail, null, 2)}\n`
    );
    await wslInput(
      this.distro, ["/usr/bin/tee", "-a", LEDGER_FILE],
      `${JSON.stringify({ ...summary, detail_path: detailPath })}\n`
    );
    return { summary, detailPath };
  }
}
