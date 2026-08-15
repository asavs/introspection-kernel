function range(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
    mean: Number((finite.reduce((a, b) => a + b, 0) / finite.length).toFixed(2))
  };
}

export function buildBoutTrace({ startedAt, endedAt, hiddenEvents, runtimeEvents }) {
  const gpu = hiddenEvents
    .filter(row => row.source === "host.nvml" && !row.error && row.values)
    .map(row => row.values);
  const assigned = runtimeEvents.find(row => row.event === "request_slot_assigned");
  const released = [...runtimeEvents].reverse().find(row => row.event === "slot_release");
  const decodes = runtimeEvents.filter(row => row.event === "decode_end");
  const tids = [...new Set(runtimeEvents
    .filter(row => row.event === "decode_begin")
    .map(row => row.tid))];
  const kvMin = decodes.map(row => row.kv_pos_min).filter(value => value >= 0);
  const kvMax = decodes.map(row => row.kv_pos_max).filter(value => value >= 0);

  return {
    schema: "ik.bout-trace.v1",
    window: {
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: new Date(endedAt) - new Date(startedAt)
    },
    gpu: {
      samples: gpu.length,
      temperature_c: range(gpu.map(row => row.temperature_c)),
      utilization_pct: range(gpu.map(row => row.gpu_util_pct)),
      power_w: range(gpu.map(row => row.power_draw_w)),
      vram_used_mb: range(gpu.map(row => row.vram_used_mb))
    },
    runtime: {
      pid: assigned?.pid ?? null,
      task_id: assigned?.task_id ?? null,
      slot_id: assigned?.slot_id ?? null,
      prompt_tokens: assigned?.n_tokens ?? null,
      decode_steps: decodes.length,
      generated_token_steps: Math.max(0, decodes.length - (assigned ? 1 : 0)),
      worker_tids: tids,
      kv_position: kvMin.length && kvMax.length
        ? { min: Math.min(...kvMin), max: Math.max(...kvMax) }
        : null,
      final_state_bytes: released?.kv_state_bytes ?? null
    }
  };
}

export function compactBoutTrace(trace, bout) {
  const pair = value => value ? `${value.min}..${value.max}` : "na";
  const tids = trace.runtime.worker_tids.length
    ? trace.runtime.worker_tids.join(",")
    : "na";
  return [
    `bout=${bout}`,
    `duration_ms=${trace.window.duration_ms}`,
    `gpu_temp_c=${pair(trace.gpu.temperature_c)}`,
    `gpu_util_pct=${pair(trace.gpu.utilization_pct)}`,
    `gpu_power_w=${pair(trace.gpu.power_w)}`,
    `pid=${trace.runtime.pid ?? "na"}`,
    `tid=${tids}`,
    `slot=${trace.runtime.slot_id ?? "na"}`,
    `generated_steps=${trace.runtime.generated_token_steps}`,
    `kv_max=${trace.runtime.kv_position?.max ?? "na"}`,
    `state_bytes=${trace.runtime.final_state_bytes ?? "na"}`
  ].join(" ");
}
