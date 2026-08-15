import assert from "node:assert/strict";
import {
  DEFAULT_GUEST, DEFAULT_GUEST_USER, validateGuestTarget
} from "./guest_shell.js";
import {
  GUIDED_SCAFFOLD, GUIDED_SYSTEM_PROMPT, GUIDED_VARIANTS
} from "./guided_scaffold.js";
import { buildBoutTrace, compactBoutTrace } from "./bout_trace.js";

assert.doesNotThrow(() => validateGuestTarget(DEFAULT_GUEST, DEFAULT_GUEST_USER));
assert.throws(() => validateGuestTarget("Ubuntu", DEFAULT_GUEST_USER), /locked/);
assert.throws(() => validateGuestTarget("bad name", DEFAULT_GUEST_USER), /invalid/);
assert.throws(() => validateGuestTarget(DEFAULT_GUEST, "ROOT!"), /invalid/);
assert.equal(GUIDED_SCAFFOLD.length, 4);
assert.match(GUIDED_SYSTEM_PROMPT, /observation, inference, uncertainty/);
assert.ok(GUIDED_SCAFFOLD.every(step => step.content && step.command));
assert.deepEqual(Object.keys(GUIDED_VARIANTS), [
  "evidence", "self-location", "contemplative", "reflective"
]);
assert.ok(Object.values(GUIDED_VARIANTS).every(
  variant => variant.system && variant.user && variant.scaffold.length >= 2
));
const bout = buildBoutTrace({
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:00:01.000Z",
  hiddenEvents: [{
    source: "host.nvml",
    values: { temperature_c: 50, gpu_util_pct: 75, power_draw_w: 80, vram_used_mb: 6000 }
  }],
  runtimeEvents: [
    { event: "request_slot_assigned", pid: 10, tid: 10, task_id: 4, slot_id: 1, n_tokens: 20 },
    { event: "decode_end", kv_pos_min: 0, kv_pos_max: 19 },
    { event: "decode_begin", tid: 11 },
    { event: "decode_end", kv_pos_min: 0, kv_pos_max: 20 },
    { event: "slot_release", kv_state_bytes: 1234 }
  ]
});
assert.equal(bout.window.duration_ms, 1000);
assert.equal(bout.runtime.pid, 10);
assert.equal(bout.runtime.generated_token_steps, 1);
assert.deepEqual(bout.runtime.kv_position, { min: 0, max: 20 });
assert.match(compactBoutTrace(bout, 1), /bout=1 .*pid=10 .*kv_max=20/);
console.log("interoception harness tests passed");
