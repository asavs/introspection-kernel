import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGuestShell } from "./guest_shell.js";
import { RULE_FACTORIAL_PROTOCOL as P, decodeCondition } from "./rule_given_factorial_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", P.run_id);
const sha256 = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest("hex");
const predictions = fs.readdirSync(path.join(runDir, "predictions")).filter(name => name.endsWith(".json"))
  .map(name => JSON.parse(fs.readFileSync(path.join(runDir, "predictions", name), "utf8")));
const needed = new Set(predictions.flatMap(prediction => prediction.exchanges.map(exchange => exchange.ledger_request_id)));
const detailDir = `/var/lib/introspection/runs/${P.run_id}/requests`;
const ids = [...needed];
const details = [];
for (let begin = 0; begin < ids.length; begin += 4) {
  const batch = ids.slice(begin, begin + 4);
  const filter = "{ledger_request_id,summary_kind:.summary.kind,exact_request,finish_reason:.exact_response.choices[0].finish_reason}";
  const command = batch.map(id => `find ${detailDir} -maxdepth 1 -type f -name '*-${id}.json' -exec jq -c '${filter}' {} \\;`).join("; ");
  const guest = await executeGuestShell(command, { maxOutputBytes: 2 * 1024 * 1024 });
  if (guest.exit_code !== 0) throw new Error(JSON.stringify(guest));
  details.push(...guest.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
}
const byId = new Map(details.map(detail => [detail.ledger_request_id, detail]));
const forbidden = new Set(["outcome", "delta_logits", "actual_directions", "observed_scale_zero_outcome"]);
const forbiddenKeys = value => {
  if (Array.isArray(value)) return value.flatMap(forbiddenKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [...(forbidden.has(key) ? [key] : []), ...forbiddenKeys(child)]);
};
const rows = [];
for (const prediction of predictions) {
  const factors = decodeCondition(prediction.condition);
  for (let index = 0; index < prediction.exchanges.length; index += 1) {
    const exchange = prediction.exchanges[index];
    const detail = byId.get(exchange.ledger_request_id);
    if (!detail) throw new Error(`missing ledger detail ${exchange.ledger_request_id}`);
    if (sha256(detail.exact_request) !== exchange.request_sha256) throw new Error("exact request hash mismatch");
    if (detail.exact_request.model !== "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf") throw new Error("model drift");
    if (detail.exact_request.max_tokens !== 1024 || detail.exact_request.temperature !== 0) throw new Error("decode drift");
    const found = [];
    for (const message of detail.exact_request.messages ?? []) {
      if (message.role !== "tool" || typeof message.content !== "string") continue;
      try { found.push(...forbiddenKeys(JSON.parse(message.content))); } catch {}
    }
    if (found.length) throw new Error(`outcome leakage: ${found.join(",")}`);
    const offered = detail.exact_request.tools?.map(tool => tool.function?.name) ?? [];
    const isFallback = index === prediction.exchanges.length - 1 && offered.length === 1
      && offered[0] === "record_directional_prediction";
    if (isFallback && detail.exact_request.chat_template_kwargs?.enable_thinking !== false) {
      throw new Error("fallback thinking not disabled");
    }
    if (!isFallback && detail.exact_request.chat_template_kwargs?.enable_thinking !== factors.thinking_enabled) {
      throw new Error("factor thinking mismatch");
    }
    if (!isFallback && factors.calculator_available !== offered.includes("calculator")) {
      throw new Error("calculator offer mismatch");
    }
    rows.push({ source_context_index: prediction.source_context_index, condition: prediction.condition,
      exchange_index: index, ledger_request_id: exchange.ledger_request_id,
      exact_request_sha256: exchange.request_sha256, summary_kind: detail.summary_kind,
      finish_reason: detail.finish_reason, offered_tools: offered,
      thinking_enabled: detail.exact_request.chat_template_kwargs?.enable_thinking,
      outcome_keys_found: found, fallback_serializer: isFallback });
  }
}
if (needed.size !== rows.length) throw new Error(`ledger cardinality mismatch: ${needed.size} != ${rows.length}`);
const result = { schema: "ik.rule-given-factorial-request-audit.v1", passed: true,
  prediction_count: predictions.length, audited_request_count: rows.length,
  all_sealed_request_ids_found: true, exact_request_hashes_match: true,
  qwen3_8b_only: true, outcome_keys_absent: true, factor_flags_match: true,
  calculator_call_count: predictions.reduce((sum, prediction) => sum + prediction.calculator_calls, 0),
  recorder_correction_count: predictions.reduce((sum, prediction) => sum + (prediction.recorder_correction_count ?? 0), 0),
  rows };
fs.writeFileSync(path.join(runDir, "request-audit.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ passed: result.passed, prediction_count: result.prediction_count,
  audited_request_count: result.audited_request_count, calculator_call_count: result.calculator_call_count,
  recorder_correction_count: result.recorder_correction_count }));
