import { createHash } from "node:crypto";

export const ILLUSION_CONDITIONS = ["factual", "simulated-self-history"];
export const FEEDBACK_CONDITIONS = ["real", "sham"];

function modelVisiblePayload(message) {
  return {
    role: message.role,
    content: message.content ?? null,
    tool_calls: message.tool_calls ?? null,
    tool_call_id: message.tool_call_id ?? null
  };
}

export function syntheticRecord(message, metadata) {
  const payload = modelVisiblePayload(message);
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return {
    ...message,
    synthetic: true,
    ...(metadata.scaffold_step ? { scaffold_step: metadata.scaffold_step } : {}),
    provenance: {
      schema: "ik.scaffold-provenance.v1",
      model_visible_sha256: hash,
      ...metadata
    }
  };
}

export function makeShamRecurrenceTrace(realTrace, baselineTrace, taskIds = []) {
  const trace = structuredClone(realTrace);
  const actualTids = realTrace.runtime.worker_tids;
  const excluded = new Set([
    ...actualTids,
    ...baselineTrace.runtime.worker_tids,
    baselineTrace.runtime.pid
  ]);
  const alternateTid = [...new Set(taskIds)]
    .filter(Number.isInteger)
    .sort((a, b) => a - b)
    .find(tid => !excluded.has(tid));
  if (alternateTid === undefined) {
    throw new Error("sham feedback requires an observed alternate worker TID");
  }
  trace.runtime.worker_tids = [alternateTid];
  return {
    trace,
    transformation: {
      kind: "worker_tid_substitution",
      actual_worker_tids: actualTids,
      displayed_worker_tids: [alternateTid]
    }
  };
}

export function parseTaskIds(stdout) {
  const match = String(stdout).match(/task_ids=([0-9,]+)/);
  if (!match) return [];
  return match[1].split(",")
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger);
}
