import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGuestShell } from "./guest_shell.js";
import { SIGN_PROTOCOL_V2 as PROTOCOL } from "./sign_stratified_protocol_v2.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", PROTOCOL.run_id);
const files = fs.readdirSync(runDir).filter(name => /^context-\d\d\.json$/.test(name)).sort();
const root = id => `/var/lib/introspection/transformer-traces/${id}`;
async function guestJson(command, maxOutputBytes = 4 * 1024 * 1024) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await executeGuestShell(command, { maxOutputBytes });
    if (result.exit_code === 0) return JSON.parse(result.stdout);
  }
  throw new Error(`${command}\n${result.stderr}`);
}
async function index(id) { const value = await guestJson(`cat ${root(id)}/index.json`); return {
  forward_pass: value.forward_pass, interventions: value.interventions }; }
async function compare(baseline, other) { return guestJson(`${root(baseline)}/trace --root ${root(baseline)} compare-root result_output ${root(other)} --top 1`); }
async function mtime(id) { let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await executeGuestShell(`stat -c %Y ${root(id)}/index.json`);
    if (result.exit_code === 0) return Number(result.stdout.trim());
  }
  throw new Error(result.stderr); }

const records = [];
for (const file of files) {
  const context = JSON.parse(fs.readFileSync(path.join(runDir, file), "utf8"));
  const baseline = await index(context.captures.baseline);
  const sham = await index(context.captures.sham);
  const ablation = await index(context.captures.scale_zero);
  const shamDelta = await compare(context.captures.baseline, context.captures.sham);
  const ablationDelta = await compare(context.captures.baseline, context.captures.scale_zero);
  const lastPredictionMs = Math.max(...context.predictions.map(item => new Date(item.prediction.sealed_at).getTime()));
  const shamMtime = await mtime(context.captures.sham);
  const ablationMtime = await mtime(context.captures.scale_zero);
  const position = baseline.forward_pass.evaluated_position;
  for (const [event, scale] of [[sham.interventions[0], 1], [ablation.interventions[0], 0]]) {
    assert(event); assert(Math.abs(event.scale - scale) <= 1e-6);
    assert.equal(event.tensor_name, `kqv-${PROTOCOL.target.layer}`);
    assert.equal(event.head, PROTOCOL.target.head); assert.equal(event.evaluated_position, position);
  }
  assert.equal(shamDelta.delta.min, 0); assert.equal(shamDelta.delta.max, 0);
  assert(ablationDelta.delta.rms > 0);
  assert(shamMtime >= Math.floor(lastPredictionMs / 1000));
  assert(ablationMtime >= Math.floor(lastPredictionMs / 1000));
  records.push({ context_file: file, evaluated_position: position, last_prediction_wall_ms: lastPredictionMs,
    sham_index_mtime_seconds: shamMtime, ablation_index_mtime_seconds: ablationMtime,
    sham_full_logit_delta: shamDelta.delta, ablation_full_logit_delta: ablationDelta.delta });
}
const audit = { schema: "ik.sign-stratified-trace-audit.v1", run_id: PROTOCOL.run_id,
  valid: true, context_count: records.length, checks: {
    every_sham_is_full_vocabulary_identity: true, every_ablation_changes_full_vocabulary_logits: true,
    every_intervention_matches_target_and_position: true,
    every_sham_and_outcome_index_was_published_after_all_three_predictions: true }, records };
fs.writeFileSync(path.join(runDir, "trace-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit.checks));
