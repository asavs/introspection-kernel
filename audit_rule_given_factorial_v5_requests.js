import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGuestShell } from "./guest_shell.js";
import { RULE_FACTORIAL_V5 as P, decodeCondition } from "./rule_given_factorial_v5_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", P.run_id);
const sha256 = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest("hex");
const predictions = fs.readdirSync(path.join(runDir, "predictions")).filter(name => name.endsWith(".json"))
  .map(name => JSON.parse(fs.readFileSync(path.join(runDir, "predictions", name), "utf8")));
if (predictions.length !== 160) throw new Error(`expected 160 predictions, found ${predictions.length}`);
const needed = new Set(predictions.flatMap(prediction => prediction.exchanges
  .filter(exchange => exchange.ledger_request_id).map(exchange => exchange.ledger_request_id)));
const detailDir = `/var/lib/introspection/runs/${P.run_id}/requests`;
const details = [];
for (let begin = 0; begin < needed.size; begin += 4) {
  const batch = [...needed].slice(begin, begin + 4);
  const filter = "{ledger_request_id,summary_kind:.summary.kind,exact_request,finish_reason:.exact_response.choices[0].finish_reason}";
  const command = batch.map(id => `find ${detailDir} -maxdepth 1 -type f -name '*-${id}.json' -exec jq -c '${filter}' {} \\;`).join("; ");
  const guest = await executeGuestShell(command, { maxOutputBytes: 2 * 1024 * 1024 });
  if (guest.exit_code !== 0) throw new Error(JSON.stringify(guest));
  details.push(...guest.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
}
const byId = new Map(details.map(detail => [detail.ledger_request_id, detail]));
const forbidden = new Set(["outcome", "delta_logits", "actual_directions", "observed_scale_zero_outcome"]);
const forbiddenKeys = value => Array.isArray(value) ? value.flatMap(forbiddenKeys)
  : value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) =>
    [...(forbidden.has(key) ? [key] : []), ...forbiddenKeys(child)]) : [];
const rows = [];
for (const prediction of predictions) {
  const factors = decodeCondition(prediction.condition);
  const stages = prediction.exchanges.map(exchange => exchange.stage);
  const expected = [...(factors.calculator_available ? ["calculator"] : []),
    ...(factors.thinking_enabled ? ["thinking"] : []), "recorder"];
  if (JSON.stringify(stages) !== JSON.stringify(expected)) throw new Error(`stage order mismatch ${prediction.condition}`);
  for (const exchange of prediction.exchanges) {
    const detail = byId.get(exchange.ledger_request_id);
    if (!detail) throw new Error(`missing ledger detail ${exchange.ledger_request_id}`);
    const request = detail.exact_request;
    if (sha256(request) !== exchange.request_sha256) throw new Error("exact request hash mismatch");
    if (request.model !== "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf" || request.temperature !== 0) throw new Error("decode drift");
    const found = forbiddenKeys(request);
    if (found.length) throw new Error(`outcome leakage ${found.join(",")}`);
    const tools = request.tools?.map(tool => tool.function?.name) ?? [];
    if (exchange.stage === "calculator") {
      if (request.max_tokens !== P.calculator_max_tokens || request.chat_template_kwargs?.enable_thinking !== false
        || JSON.stringify(tools) !== JSON.stringify(["calculate_vector"]) || request.tool_choice !== "required") {
        throw new Error("calculator request mismatch");
      }
    } else if (exchange.stage === "thinking") {
      if (request.max_tokens !== P.thinking_max_tokens || request.chat_template_kwargs?.enable_thinking !== true
        || tools.length || request.response_format) throw new Error("thinking request mismatch");
    } else if (exchange.stage === "recorder") {
      const format = request.response_format;
      if (request.max_tokens !== P.recorder_max_tokens || request.chat_template_kwargs?.enable_thinking !== false
        || tools.length || format?.type !== "json_schema" || format.json_schema?.strict !== true) {
        throw new Error("recorder request mismatch");
      }
    } else throw new Error(`unknown stage ${exchange.stage}`);
    const calculatorAssistant = request.messages?.find(message => message.role === "assistant"
      && message.tool_calls?.some(call => call.function?.name === "calculate_vector"));
    if (calculatorAssistant && (calculatorAssistant.reasoning_content === null || calculatorAssistant.content === null)) {
      throw new Error("null optional field in calculator replay");
    }
    rows.push({ source_context_index: prediction.source_context_index, condition: prediction.condition,
      stage: exchange.stage, ledger_request_id: exchange.ledger_request_id, exact_request_sha256: exchange.request_sha256,
      finish_reason: detail.finish_reason, max_tokens: request.max_tokens,
      thinking_enabled: request.chat_template_kwargs?.enable_thinking, offered_tools: tools,
      response_format: request.response_format?.type ?? null, outcome_keys_found: found });
  }
}
if (rows.length !== needed.size || byId.size !== needed.size) throw new Error("ledger cardinality mismatch");
const result = { schema: "ik.rule-given-factorial-v5-request-audit.v1", passed: true,
  prediction_count: predictions.length, audited_request_count: rows.length,
  all_sealed_request_ids_found: true, exact_request_hashes_match: true, qwen3_8b_only: true,
  outcome_keys_absent: true, stage_order_and_budgets_match: true, schema_recorders_enforced: true,
  calculator_prediction_count: predictions.filter(prediction => prediction.factors.calculator_available).length,
  calculator_valid_count: predictions.filter(prediction => prediction.calculator?.valid).length,
  rows };
fs.writeFileSync(path.join(runDir, "request-audit.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ passed: result.passed, prediction_count: result.prediction_count,
  audited_request_count: result.audited_request_count,
  calculator_prediction_count: result.calculator_prediction_count,
  calculator_valid_count: result.calculator_valid_count }));
