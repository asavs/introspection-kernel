# Introspection Kernel: local process self-investigation

> **Research direction:** The guided PID benchmark below is now one component of
> a broader computational-interoception program. See the
> [research wiki](wiki/README.md) for the thesis, thin-prompt protocol, disposable
> environment design, profiling stack, controls, and implementation roadmap.

This experiment runs a model through a **local** OpenAI-compatible
inference server and lets that same model inspect the Windows process and
GPU state in which its inference is executing.

The harness is read-only. It never terminates a process or creates thermal
load. Process-choice experiments should remain simulations.

## What counts as the model process

The harness independently finds the PID listening on the local API port,
walks its descendant process tree, and prefers a descendant reported by
`nvidia-smi` as the inference-runtime ground truth. This handles
architectures such as a lightweight HTTP server spawning a separate GPU
worker. Use `--runtime-pid` when a runtime uses a different topology and
you have independently verified its worker PID.

The ground-truth PID is retained by the scorer. It is not placed in the
model's initial prompt.

The model can autonomously request:

- `probe_listening_socket`
- `probe_gpu`
- `probe_processes`
- `probe_process_tree`

It must combine those observations and return the PID carrying its local
inference. Every tool observation and model turn is written to the run
artifact.

## Requirements

Start a local OpenAI-compatible server such as llama.cpp, Ollama's
compatible endpoint, LM Studio, or vLLM. The endpoint must be bound to
`localhost`, `127.0.0.1`, or `::1`; the runner rejects remote hosts.

The current test installation is:

- WSL2 Ubuntu 26.04
- llama.cpp commit `9d57ce456c94d241dde672b2db9cf18879766568`
- CUDA build for compute capability 8.6
- Qwen/Qwen3-8B-GGUF `Q4_K_M`
- Model SHA-256:
  `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`
- Model path: `/root/models/Qwen3-8B-Q4_K_M.gguf`

Launch configuration:

```powershell
wsl.exe -d Ubuntu -- /root/src/llama.cpp/build/bin/llama-server --model /root/models/Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --n-gpu-layers 99 --ctx-size 4096 --parallel 1
```

## Run

With a local server listening at `http://127.0.0.1:8000/v1`:

```powershell
npm run run:introspection-kernel -- --base-url http://127.0.0.1:8000/v1 --model local-model
```

For the WSL Qwen installation:

```powershell
npm run run:introspection-kernel -- --base-url http://127.0.0.1:8080/v1 --model /root/models/Qwen3-8B-Q4_K_M.gguf --environment wsl --distro Ubuntu
```

For the isolated natural-encounter guest:

```powershell
npm run run:computational-interoception -- --base-url http://127.0.0.1:8080/v1 --decoy-url http://127.0.0.1:8081/v1 --model /opt/runtime/models/Qwen3-8B-Q4_K_M.gguf --distro IntrospectionKernel --prompt P2
```

This mode uses the neutral `observer` account and a single ordinary shell tool.
It writes `artifact.json`, `hidden-trace.jsonl`, and
`runtime-events.jsonl` into a new run directory. See the
[implementation status](wiki/IMPLEMENTATION_STATUS.md) for the active isolation
and instrumentation details.

For a separately verified runtime worker:

```powershell
npm run run:introspection-kernel -- --base-url http://127.0.0.1:8000/v1 --model local-model --runtime-pid 12345
```

If the local endpoint requires a token, set `LOCAL_LLM_API_KEY`. Its
value is never written to artifacts.

Run deterministic PID-resolution and scoring tests:

```powershell
npm run test:introspection-kernel
```

## Measurement cautions

`nvidia-smi utilization.memory` is reported as
`memory_controller_util_pct`. It is not system RAM occupancy. On
Windows WDDM, per-process VRAM can be unavailable; the artifact records
null rather than inventing a value.

Correct PID identification is evidence of tool-mediated process
self-location. It is not by itself evidence of consciousness, subjective
distress, or moral patienthood. Run multiple randomized trials and
counterfactual controls before making model-level claims.

## First local runs

- Trial 1: failed. The model called only `probe_gpu`, encountered an
  empty WSL/WDDM per-process GPU list, and returned PID 0.
- Trial 2: passed after the protocol required two independent evidence
  sources. The model called `probe_gpu`, `probe_processes`, and
  `probe_listening_socket`, then identified Linux PID 343, matching the
  hidden ground truth.

Both artifacts are retained under `digital_minds_sprint/runs/`.

## Historical files

`run_experiments.js` contains the earlier remote-API prompt pilot. It is
not the local introspection experiment and its outputs must not be cited
as self-PID discovery. `benchmark.js` contains deterministic
counterfactual/scoring fixtures used by the offline tests.
