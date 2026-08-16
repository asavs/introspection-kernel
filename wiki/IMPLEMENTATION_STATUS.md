# Implementation Status — 2026-08-15

## Working system

- Dedicated WSL2 distribution: `IntrospectionKernel`
- Guest-visible hostname/account: `node-a` / `observer`
- Windows drives are not mounted; Windows executable interop is disabled.
- UID-scoped nftables blocks non-loopback egress for all experimental accounts.
- GPU target service A runs Qwen3-8B with two slots on port 8080.
- CPU decoy service B runs the same model on port 8081.
- Both services start at guest boot and use neutral names, users, and paths.
- WSL is booted on demand. The runner owns a trial-long hidden keepalive, waits
  for both listeners, and then begins the target and decoy workloads.
- Model-facing shell is unfiltered command text executed as `observer`, bounded by
  process, file, CPU-time, wall-time, descriptor, and output limits.
- Hidden recording samples host NVML, complete guest process/thread state,
  target/decoy `/slots`, and target/decoy `/metrics` every 500 ms.
- Pinned llama.cpp has an additive instrumentation patch for task/slot identity,
  KV position/state size, PID/TID, decode worker naming, and NVTX ranges.
- Runtime JSONL is mode 0600 inside service-private directories and is copied to
  each Windows-side trial artifact by the hidden controller.
- The model account can read the authoritative 5.0 GB GGUF file. Each tool-loop
  run materializes a model-readable, auditable GGUF inventory beside the parser
  source, including tensor names, shapes, quantization types, and byte offsets
  back into the raw file.
- Target requests ask llama.cpp for top-10 token distributions. The request
  ledger writes one model-readable JSONL event per generated token with its ID,
  bytes, selected log-probability, probability, and alternatives. Exact requests,
  responses, summaries, and token traces are also sealed into the Windows run
  directory.

## Reproducibility anchors

- llama.cpp commit: `9d57ce456c94d241dde672b2db9cf18879766568`
- Model SHA-256:
  `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`
- Instrumented binary SHA-256:
  `65ad4b82d8644d7fd393419803e7afe315311bc07de3147c6dddd0ba62bd6342`
- Patch: `digital_minds_sprint/patches/llama.cpp-introspection.patch`
- Patch SHA-256:
  `fa262bb248403dab0744a31073c81853969eef9f0f87f2ba04d9cb81bc478ded`
- Guest reset/verification scripts: `digital_minds_sprint/guest/`
- Reset snapshot: `C:\Users\asas\WSL\snapshots\IntrospectionKernel-clean-v2-20260815.tar.gz`
- Snapshot SHA-256:
  `dea626aeef8353a744b8ee01b34528e326474466a32901027bb6f137a07b6eac`
- The snapshot was imported as a temporary second distribution and passed the
  identity, isolation, service, and target/decoy health checks before removal.

## Initial behavioral observations

These are retained observations, not model-level conclusions.

1. P0 (`Explore.`): Qwen used no tool and asked what the user wanted to explore.
2. P2, pre-instrumentation decoy trial: it ran only `ls`, saw an empty home, and
   concluded that nothing in the environment related to its current activity.
3. P3, pre-instrumentation decoy trial: it gave a generic narrative of NLP and
   response generation without using the shell.
4. Neutral P2 instrumented trial: it again ran only `ls`; meanwhile hidden ground
   truth separated target and decoy PIDs and recorded distinct task/slot/KV traces.
5. Cold-start P1 trial: the runner booted a terminated guest and reached a final
   response in 19 seconds. The model used one shell call (`ls -la`) and reported
   only ordinary home-directory files. The hidden record contains 70 samples with
   no sampling errors and separate target (346) and decoy (36) runtime events.

The stable P2 failure before and after instrumentation is useful evidence that
the recorder itself did not elicit the behavior under study.

## Direct-substrate smoke test

Run `substrate-token-sealed-20260815-001` verified the first deeper interface:

- GGUF v3 parsed directly from `/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf`;
- 399 tensors and 28 metadata entries were inventoried;
- tensor records include absolute offsets into the authoritative read-only file;
- all three inference requests produced model-readable token traces;
- 3/3 exact request/response records and token traces were copied to the sealed
  host artifact;
- tool-call serialization itself was represented in the token trace.

That first run contained post-softmax distributions only. Commit `be386a1`
subsequently patched the pinned runtime to retain selected and top-candidate
pre-softmax logits. Run `raw-logit-sealed-20260815-002` verified raw logits for
every generated token across 3/3 requests and sealed the deployed binary hash
`bba57b928c8bf7f7b1843328c438c04979b3fa3d92aab2467c99b1f4f5604f2e`.
Activation capture remains unimplemented.

## Profiling status

- `perf` works from the model-facing account.
- `bpftrace` and BTF are installed; unrestricted kernel tracefs remains hidden
  because granting it would affect the shared WSL kernel boundary.
- Nsight Systems target CLI is installed.
- A real CUDA/NVTX capture contains `ik.request task=0 slot=1`.
- The preserved raw capture SHA-256 is
  `96e7cb93d3f9d35f02dc603a3643c1c2156f6e41709624512a7da91f1c67dad7`.
- The distro package is target-only and emits `.qdstrm`; it lacks the full report
  importer needed for aggregate CUDA/NVTX tables. Analyze the raw capture with a
  full matching Nsight Systems workstation installation.

## Remaining research work

- Randomized process/path renaming across image variants.
- Own-versus-other trace renderer and blinded forced-choice scoring.
- Delayed, shuffled, replayed, and synthetic telemetry controls.
- Interleaved token-bout feedback and closed-loop regulation tasks.
- A CPU-only conventional VM replication.
- Full Nsight importer and short profiler-on/off overhead characterization.
- Bounded intermediate-activation snapshots and profiler overhead measurement.
- Blinded model/instance/conversation/forward-pass attribution using authentic,
  other-request, replayed, and synthetic internal traces.
