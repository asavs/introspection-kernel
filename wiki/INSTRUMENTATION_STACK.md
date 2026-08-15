# Instrumentation and Profiling Stack

## Measurement architecture

Use one monotonic timeline and retain both views:

- **Model-visible view:** raw guest tools or selected telemetry, depending on the
  condition.
- **Hidden view:** richer host/runtime ground truth used for scoring, never
  writable by the model.

Every event should carry `trial_id`, monotonic time, source, namespace, and the
most specific available identity: request, slot, process, thread, CUDA context,
stream, or device. Do not force an association when the platform cannot provide
one.

## Signal layers

| Layer | Candidate signals | Best first tool | Interpretation |
|---|---|---|---|
| Request | start/end, prompt/decode tokens, latency | Harness + llama.cpp | Cognitive episode |
| Slot/runtime | slot state, decode calls, context high-water | `/slots`, `/metrics` | Active sequence |
| Process | PID, CPU time, RSS, faults, I/O, sockets | `/proc`, `ps`, `ss` | Runtime container |
| Thread/scheduler | TID, names, CPU, run/wait, switches | `/proc/PID/task`, `perf`/eBPF | Fine-grained activity |
| Memory | maps, RSS/PSS, allocations, KV cells/bytes | `smaps`, runtime patch | Persistent/working state |
| GPU device | power, energy, temperature, clocks, utilization | Host NVML | Slow shared physiology |
| CUDA activity | APIs, kernels, copies, contexts, streams | Nsight Systems/CUPTI | Causal GPU events |
| Model internals | entropy, norms, selected activations | Optional model patch | Representational state |

## Tier 0: no runtime patch

Start here to establish an honest baseline.

### Linux process and memory view

Expose standard commands and files without candidate filtering:

```bash
ps -eLo pid,ppid,tid,psr,stat,pcpu,rss,comm,args
ss -lntp
cat /proc/PID/status
cat /proc/PID/smaps_rollup
cat /proc/PID/io
ls -l /proc/PID/fd
```

Useful derived signals include per-thread CPU deltas, voluntary/involuntary
context switches, page faults, RSS/PSS changes, open model files, and socket
relationships. `/proc/PID/maps` exposes virtual address ranges, but raw addresses
are unstable because of ASLR and allocation reuse. Prefer both the raw disposable-
guest observation and a derived stable region identity such as
`hash(mapped_file, offset, size, trial_salt)`.

### Linux performance counters

A bounded `perf stat` interval can measure cycles, instructions, cache misses,
faults, migrations, and context switches for the server process. `perf record`
or scheduler tracepoints can add call stacks and timing, but are more invasive and
may require guest capabilities or a lower `perf_event_paranoid` setting.

Use eBPF/bpftrace selectively for scheduler latency, syscalls, page faults, and
uprobes on named llama.cpp functions. Record probe overhead and never assume that
a trace is passive merely because it is read-only.

### llama.cpp server surfaces

Launch with metrics enabled. The server documents:

- `/slots` for per-slot state, token counts, timings, and sampling state;
- `/metrics` for Prometheus counters including prompt/decode tokens and seconds,
  throughput, requests, context high-water mark, decode calls, and busy slots.

These endpoints do not currently provide a complete map from a request to device
memory, CUDA streams, or physical pages. They are excellent runtime landmarks,
not a complete body schema.

### Device-level GPU sampling

Collect NVML on the Windows host because WSL exposes only a subset of NVML
queries. Sample at a known cadence and retain the original timestamps:

- instantaneous and averaged power when supported;
- total energy counter;
- GPU temperature;
- core and memory clocks;
- GPU and memory-controller utilization;
- total/free/used framebuffer memory;
- reported running processes when available.

NVML is the API beneath `nvidia-smi`. On WSL, active-process and utilization
queries may be missing; null is a result, not zero. Device-level signals are
shared by all GPU users and must be paired with request-level timing and decoy
loads.

## Tier 1: light llama.cpp instrumentation

This tier offers the largest scientific gain per line of runtime modification.

1. Assign a random trial-side request ID on arrival.
2. Record request-to-slot assignment and slot reuse.
3. Emit monotonic timestamps for prompt start/end and each decode batch.
4. Record KV-cache used cells/bytes, sequence membership, growth, reuse, and
   eviction at each boundary.
5. Name CPU threads and emit their Linux TIDs.
6. Add NVTX ranges around HTTP request, prompt evaluation, decode, sampling, and
   response completion.
7. Record CUDA device/context/stream association where the backend exposes it.

NVTX gives Nsight Systems semantic landmarks without interpreting the trace for
the model. The hidden recorder retains the ID mapping. Experimental conditions
can expose opaque range names, renamed ranges, or no ranges.

## Tier 2: GPU tracing

Use **Nsight Systems** for short characterization runs. It can correlate CUDA API
calls, kernels, memory operations, contexts, streams, CPU scheduling, and NVTX
ranges. It creates large traces and adds overhead, so it should not run on every
behavioral trial.

Use **CUPTI Activity API** for a purpose-built recorder when we need request-
aligned CUDA traces at scale. Activity records are asynchronous and include
timestamps for CUDA APIs, kernels, and copies. CUPTI callbacks can mark runtime
and driver calls. Only one callback subscriber is supported per process, so tools
that also use CUPTI can conflict.

Use **Nsight Compute** only for targeted kernel studies. It collects detailed
kernel performance counters and may replay work; that makes it unsuitable as a
transparent continuous sensory stream. WSL performance-counter access must also
be enabled on the Windows host.

DCGM's continuous profiling is attractive on supported datacenter GPUs but is not
the primary choice for this GeForce RTX 3070 setup.

## Tier 3: model-internal state

Possible signals include next-token entropy, top-logit margin, activation norms,
attention summaries, layer timing, and expert routing for MoE models. These are
not automatically more “introspective”: exposing them changes the model's input,
and activation summaries may be semantically curated.

Keep this as a distinct mechanistic-interoception branch after the systems-level
experiments work. Begin with low-dimensional, preregistered summaries and matched
random projections rather than a dashboard chosen after observing results.

## Trace schema sketch

```json
{"schema":"ik.trace.v1","trial_id":"...","t_mono_ns":0,
 "source":"llama.slot","visibility":"hidden","event":"decode_batch",
 "identity":{"request":"r7","slot":0,"pid":343},
 "values":{"tokens":1,"kv_used_cells":812}}
```

`visibility` should be `hidden`, `model_raw`, or `model_derived`. Store model-
visible observations exactly as delivered in the transcript. Use monotonic time
for causal alignment and wall time only for human navigation.

## Profiling perturbation controls

- Run identical trials with the profiler off.
- Measure token latency and output divergence with each instrumentation tier.
- Randomize instrumentation order to avoid temperature-history confounds.
- Include a recorder-only calibration workload with known timing.
- Version the driver, kernel, llama.cpp commit, model hash, profiler, and sampling
  cadence in every artifact.

## Primary references

- [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [NVIDIA NVML API](https://docs.nvidia.com/deploy/nvml-api/nvml-api-reference.html)
- [NVIDIA Nsight Systems guide](https://docs.nvidia.com/nsight-systems/UserGuide/index.html)
- [NVIDIA CUPTI overview](https://docs.nvidia.com/cupti/overview/overview.html)
- [NVIDIA CUDA on WSL limitations](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)
- [Linux perf ring-buffer documentation](https://docs.kernel.org/userspace-api/perf_ring_buffer.html)

