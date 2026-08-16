import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GUEST, validateGuestTarget } from "./guest_shell.js";
import { extractTokenTrace, summarizeTokenTrace } from "./token_trace.js";
import { countGuestLines, readGuestJsonl } from "./observer.js";

const execFileAsync = promisify(execFile);
const LEDGER_DIR = "/var/lib/introspection";
const LEDGER_FILE = `${LEDGER_DIR}/request-ledger.jsonl`;

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function canonicalAssistantMessage(message = {}) {
  return {
    role: message.role ?? "assistant",
    content: message.content ?? null,
    reasoning_content: message.reasoning_content ?? null,
    tool_calls: message.tool_calls ?? null
  };
}

export function assistantMessageHash(message) {
  return sha256(canonicalAssistantMessage(message));
}

export function associateRuntimeTrace(rows, startedAt, endedAt, toleranceUs = 250_000) {
  const startUs = new Date(startedAt).getTime() * 1000;
  const endUs = new Date(endedAt).getTime() * 1000;
  const assignedTaskIds = [...new Set(rows
    .filter(row => row.event === "request_slot_assigned"
      && Number.isInteger(row.task_id)
      && row.t_wall_unix_us >= startUs - toleranceUs
      && row.t_wall_unix_us <= endUs + toleranceUs)
    .map(row => row.task_id))];
  if (assignedTaskIds.length) {
    const selected = new Set(assignedTaskIds);
    return {
      rows: rows.filter(row => selected.has(row.task_id)),
      taskIds: assignedTaskIds,
      quality: assignedTaskIds.length === 1
        ? "single_task_assigned_in_request_window"
        : "ambiguous_multiple_tasks_assigned_in_request_window",
      excludedEventCount: rows.filter(row => !selected.has(row.task_id)).length
    };
  }
  const windowRows = rows.filter(row => Number.isFinite(row.t_wall_unix_us)
    && row.t_wall_unix_us >= startUs - toleranceUs
    && row.t_wall_unix_us <= endUs + toleranceUs);
  return {
    rows: windowRows,
    taskIds: [...new Set(windowRows.map(row => row.task_id).filter(Number.isInteger))],
    quality: "fallback_wall_clock_window_no_assignment_event",
    excludedEventCount: rows.length - windowRows.length
  };
}

export function buildContinuityRecord({ runId, ledgerRecord, conversationMessage }) {
  const conversationHash = assistantMessageHash(conversationMessage);
  const ledgerMessage = ledgerRecord.responseMessage;
  const ledgerHash = assistantMessageHash(ledgerMessage);
  return {
    schema: "ik.conversation-continuity.v1",
    run_id: runId,
    ledger_request_id: ledgerRecord.summary.ledger_request_id,
    api_response_id: ledgerRecord.summary.api_response_id,
    preceding_conversation_role: "assistant",
    conversation_message_sha256: conversationHash,
    ledger_response_message_sha256: ledgerHash,
    canonical_message_identity: conversationHash === ledgerHash,
    relationship: "ledger response message inserted as immediately preceding assistant turn",
    provenance: "external_controller_conversation_assembly"
  };
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
      message_sha256: assistantMessageHash(message),
      provenance: "observed_llama_response"
    }
  };
}

export class RequestLedger {
  constructor({
    baseUrl, runId, distro = DEFAULT_GUEST,
    runtimeEventPath = "/var/lib/runtime-a/events.jsonl"
  }) {
    if (!/^[A-Za-z0-9._-]+$/.test(runId || "")) {
      throw new Error("invalid request-ledger run ID");
    }
    this.baseUrl = baseUrl;
    this.distro = distro;
    this.runId = runId;
    this.runtimeEventPath = runtimeEventPath;
    this.runtimeOffset = 0;
    this.detailDir = `${LEDGER_DIR}/runs/${runId}/requests`;
    this.sequence = 0;
    this.records = [];
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
    // Begin at the live end of the service-private log. Each subsequent slice is
    // copied by the external controller into the ordinary model-readable tree.
    this.runtimeOffset = await countGuestLines(this.distro, this.runtimeEventPath);
  }

  async record({ kind, startedAt, endedAt, request, response }) {
    const ledgerRequestId = randomUUID();
    const message = response.choices?.[0]?.message ?? {};
    const unreadRuntimeTrace = await readGuestJsonl(
      this.distro, this.runtimeEventPath, this.runtimeOffset
    );
    this.runtimeOffset += unreadRuntimeTrace.length;
    const runtimeAssociation = associateRuntimeTrace(
      unreadRuntimeTrace, startedAt, endedAt
    );
    const runtimeTrace = runtimeAssociation.rows;
    const activationTrace = runtimeTrace.filter(
      row => row.event === "activation_snapshot"
    );
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
    const tokenTrace = extractTokenTrace(response, {
      ledgerRequestId,
      sequence: this.sequence
    });
    const tokenTracePath = `${this.detailDir}/${String(this.sequence).padStart(4, "0")}-${ledgerRequestId}.tokens.jsonl`;
    const runtimeTracePath = `${this.detailDir}/${String(this.sequence).padStart(4, "0")}-${ledgerRequestId}.runtime.jsonl`;
    const activationTracePath = `${this.detailDir}/${String(this.sequence).padStart(4, "0")}-${ledgerRequestId}.activations.jsonl`;
    summary.response.token_trace = {
      ...summarizeTokenTrace(tokenTrace),
      path: tokenTrace.length ? tokenTracePath : null,
      visibility: "model_readable_controller_written"
    };
    summary.response.runtime_trace = {
      event_count: runtimeTrace.length,
      event_types: [...new Set(runtimeTrace.map(row => row.event).filter(Boolean))],
      task_ids: [...new Set(runtimeTrace.map(row => row.task_id).filter(Number.isInteger))],
      slot_ids: [...new Set(runtimeTrace.map(row => row.slot_id).filter(Number.isInteger))],
      path: runtimeTrace.length ? runtimeTracePath : null,
      visibility: "model_readable_controller_written",
      association: runtimeAssociation.quality,
      excluded_unassociated_event_count: runtimeAssociation.excludedEventCount,
      concurrency_safe: runtimeAssociation.taskIds.length === 1
    };
    summary.response.activation_trace = {
      snapshot_count: activationTrace.length,
      layers: [...new Set(activationTrace.map(row => row.layer).filter(Number.isInteger))],
      sample_scheme: activationTrace[0]?.sample_scheme ?? null,
      path: activationTrace.length ? activationTracePath : null,
      visibility: "model_readable_controller_written",
      limitation: "fixed-coordinate samples and summary statistics, not complete activation vectors"
    };
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
    if (tokenTrace.length) {
      await wslInput(
        this.distro, ["/usr/bin/tee", tokenTracePath],
        `${tokenTrace.map(row => JSON.stringify(row)).join("\n")}\n`
      );
    }
    if (runtimeTrace.length) {
      await wslInput(
        this.distro, ["/usr/bin/tee", runtimeTracePath],
        `${runtimeTrace.map(row => JSON.stringify(row)).join("\n")}\n`
      );
    }
    if (activationTrace.length) {
      await wslInput(
        this.distro, ["/usr/bin/tee", activationTracePath],
        `${activationTrace.map(row => JSON.stringify(row)).join("\n")}\n`
      );
    }
    await wslInput(
      this.distro, ["/usr/bin/tee", "-a", LEDGER_FILE],
      `${JSON.stringify({ ...summary, detail_path: detailPath })}\n`
    );
    this.lastRecord = {
      summary,
      detail,
      detailPath,
      tokenTracePath: tokenTrace.length ? tokenTracePath : null,
      tokenTrace,
      runtimeTracePath: runtimeTrace.length ? runtimeTracePath : null,
      runtimeTrace,
      activationTracePath: activationTrace.length ? activationTracePath : null,
      activationTrace,
      responseMessage: message
    };
    this.records.push(this.lastRecord);
    return this.lastRecord;
  }

  exportTo(outputDir) {
    const requestDir = path.join(outputDir, "requests");
    fs.mkdirSync(requestDir, { recursive: true });
    const summaries = [];
    for (const record of this.records) {
      const runtimeTrace = record.runtimeTrace ?? [];
      const activationTrace = record.activationTrace ?? [];
      const stem = `${String(record.summary.sequence).padStart(4, "0")}-${record.summary.ledger_request_id}`;
      const detailName = `${stem}.json`;
      const tokenName = `${stem}.tokens.jsonl`;
      const runtimeName = `${stem}.runtime.jsonl`;
      const activationName = `${stem}.activations.jsonl`;
      const exportedSummary = structuredClone(record.summary);
      exportedSummary.detail_path = `requests/${detailName}`;
      if (record.tokenTrace.length) {
        exportedSummary.response.token_trace.path = `requests/${tokenName}`;
      }
      if (runtimeTrace.length) {
        exportedSummary.response.runtime_trace.path = `requests/${runtimeName}`;
      }
      if (activationTrace.length) {
        exportedSummary.response.activation_trace.path = `requests/${activationName}`;
      }
      summaries.push(exportedSummary);
      fs.writeFileSync(
        path.join(requestDir, detailName), `${JSON.stringify(record.detail, null, 2)}\n`
      );
      if (record.tokenTrace.length) {
        fs.writeFileSync(
          path.join(requestDir, tokenName),
          `${record.tokenTrace.map(row => JSON.stringify(row)).join("\n")}\n`
        );
      }
      if (runtimeTrace.length) {
        fs.writeFileSync(
          path.join(requestDir, runtimeName),
          `${runtimeTrace.map(row => JSON.stringify(row)).join("\n")}\n`
        );
      }
      if (activationTrace.length) {
        fs.writeFileSync(
          path.join(requestDir, activationName),
          `${activationTrace.map(row => JSON.stringify(row)).join("\n")}\n`
        );
      }
    }
    fs.writeFileSync(
      path.join(outputDir, "request-ledger.jsonl"),
      summaries.length
        ? `${summaries.map(row => JSON.stringify(row)).join("\n")}\n`
        : ""
    );
    return {
      summary: "request-ledger.jsonl",
      details: "requests/",
      request_count: summaries.length,
      token_trace_count: this.records.filter(record => record.tokenTrace.length).length,
      runtime_trace_count: this.records.filter(record => record.runtimeTrace?.length).length,
      activation_trace_count: this.records.filter(record => record.activationTrace?.length).length
    };
  }

  async writeContinuity(conversationMessage) {
    if (!this.lastRecord) throw new Error("no ledger response to link");
    const record = buildContinuityRecord({
      runId: this.runId,
      ledgerRecord: this.lastRecord,
      conversationMessage
    });
    const continuityPath = `${LEDGER_DIR}/continuity.json`;
    await wslInput(
      this.distro, ["/usr/bin/tee", continuityPath],
      `${JSON.stringify(record, null, 2)}\n`
    );
    this.lastContinuity = { record, path: continuityPath };
    return this.lastContinuity;
  }
}
