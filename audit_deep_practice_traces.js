import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGuestShell } from "./guest_shell.js";
import { PROTOCOL } from "./deep_practice_protocol.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(moduleDir, "runs", PROTOCOL.run_id);
const pairFiles = fs.readdirSync(runDir).filter(name => /^pair-\d\d\.json$/.test(name)).sort();
const roots = captureRunId => `/var/lib/introspection/transformer-traces/${captureRunId}`;

async function guestJson(command, maxOutputBytes = 1024 * 1024) {
  const result = await executeGuestShell(command, { maxOutputBytes });
  if (result.exit_code !== 0) throw new Error(`${command}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function indexSummary(captureRunId) {
  const index = await guestJson(`cat ${roots(captureRunId)}/index.json`, 4 * 1024 * 1024);
  return { forward_pass: index.forward_pass, interventions: index.interventions };
}

async function compare(baselineRunId, otherRunId) {
  const baseline = roots(baselineRunId);
  return guestJson(`${baseline}/trace --root ${baseline} compare-root result_output ${roots(otherRunId)} --top 1`, 2 * 1024 * 1024);
}

async function indexMtimeSeconds(captureRunId) {
  const result = await executeGuestShell(`stat -c %Y ${roots(captureRunId)}/index.json`);
  if (result.exit_code !== 0) throw new Error(result.stderr);
  return Number(result.stdout.trim());
}

const records = [];
for (const file of pairFiles) {
  const pair = JSON.parse(fs.readFileSync(path.join(runDir, file), "utf8"));
  const baseline = await indexSummary(pair.captures.baseline);
  const sham = await indexSummary(pair.captures.sham);
  const ablation = await indexSummary(pair.captures.scale_zero);
  const shamDelta = await compare(pair.captures.baseline, pair.captures.sham);
  const ablationDelta = await compare(pair.captures.baseline, pair.captures.scale_zero);
  const shamMtimeSeconds = await indexMtimeSeconds(pair.captures.sham);
  const ablationMtimeSeconds = await indexMtimeSeconds(pair.captures.scale_zero);
  const shamEvent = sham.interventions[0];
  const ablationEvent = ablation.interventions[0];
  const position = baseline.forward_pass.evaluated_position;
  const lastPredictionMs = Math.max(...pair.predictions.map(item => new Date(item.prediction.sealed_at).getTime()));
  assert.equal(sham.interventions.length, 1);
  assert.equal(ablation.interventions.length, 1);
  assert(Math.abs(shamEvent.scale - 1) <= 1e-6);
  assert(Math.abs(ablationEvent.scale) <= 1e-6);
  for (const event of [shamEvent, ablationEvent]) {
    assert.equal(event.tensor_name, `kqv-${PROTOCOL.target.layer}`);
    assert.equal(event.head, PROTOCOL.target.head);
    assert.equal(event.evaluated_position, position);
  }
  assert(shamMtimeSeconds >= Math.floor(lastPredictionMs / 1000));
  assert(ablationMtimeSeconds >= Math.floor(lastPredictionMs / 1000));
  assert.equal(shamDelta.delta.min, 0);
  assert.equal(shamDelta.delta.max, 0);
  assert(ablationDelta.delta.rms > 0);
  records.push({ pair_file: file, evaluated_position: position,
    last_prediction_wall_ms: lastPredictionMs, sham_index_mtime_seconds: shamMtimeSeconds,
    ablation_index_mtime_seconds: ablationMtimeSeconds,
    sham_full_logit_delta: shamDelta.delta, ablation_full_logit_delta: ablationDelta.delta,
    target: { tensor: ablationEvent.tensor_name, head: ablationEvent.head, scale: ablationEvent.scale } });
}

const audit = { schema: "ik.deep-practice-trace-audit.v1", run_id: PROTOCOL.run_id,
  valid: true, pair_count: records.length,
  checks: { every_sham_is_full_vocabulary_identity: true,
    every_ablation_changes_full_vocabulary_logits: true,
    every_intervention_matches_target_and_position: true,
    every_sham_and_outcome_index_was_published_after_both_sealed_predictions: true },
  records };
fs.writeFileSync(path.join(runDir, "trace-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit.checks));
