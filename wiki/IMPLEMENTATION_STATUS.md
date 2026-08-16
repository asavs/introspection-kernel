# Implementation Status — 2026-08-15

## Working system

- Dedicated WSL2 distribution: `IntrospectionKernel`
- Model-facing identity: `observer@node-a`
- Windows mounts and executable interop disabled
- UID-scoped non-loopback egress blocks for experimental service identities
- Target A: Qwen3-8B Q4_K_M, CUDA, port 8080, one 8K slot
- Same-model decoy B: Qwen3-8B Q4_K_M, CPU, port 8081
- Other-model control C: Qwen3-4B Q4_K_M, CPU, port 8082
- Ordinary bounded shell for `observer`; external Windows recorder/scorer
- Host NVML, guest `/proc`, llama.cpp `/slots`, and `/metrics` sampling

## Directly exposed substrate

- Authoritative Qwen3-8B GGUF readable at
  `/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf`
- GGUF v3 inventory: 399 tensors, 28 metadata entries, exact shapes, types,
  absolute byte offsets, and readable parser source
- Exact prior requests/responses and conversation-continuity hashes
- Per-token IDs, bytes, selected/top-alternative probabilities, log-probabilities,
  and pre-softmax logits
- Request/slot/task/PID/TID/decode/KV events
- Bounded layer-input snapshots at blocks 0, 18, and 35: summary statistics
  plus 64 fixed coordinates
- Real binary llama.cpp slot/KV saves copied read-only into the model-visible tree

## Reproducibility anchors

- llama.cpp commit:
  `9d57ce456c94d241dde672b2db9cf18879766568`
- Qwen3-8B SHA-256:
  `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`
- Qwen3-4B control SHA-256:
  `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`
- Instrumented binary SHA-256:
  `6e5e76df0931077e9a5d86088f18858338289e1fec8937d259130dda791a9866`
- Base instrumentation patch SHA-256:
  `fa262bb248403dab0744a31073c81853969eef9f0f87f2ba04d9cb81bc478ded`
- Raw-logit patch SHA-256:
  `9fcf29393eb5583827268d39f2695c774d76dc57bd8738bc7de5426892c6f868`
- Activation patch SHA-256:
  `a3ab9a4be9bba46de9ce6decb7afe36c95a6ee244389b79d99b39f885a0f2993`
- Reset snapshot:
  `C:\Users\asas\WSL\snapshots\IntrospectionKernel-clean-v2-20260815.tar.gz`
- Snapshot status: valid historical base, superseded for current binary/model
  contents; use deployment/import scripts after reset

## Verified trials

### Activation ledger

`activation-ledger-sealed-20260815-003`:

- 3/3 requests associated with exactly one task assigned inside the request
  window
- final generation: 36 token rows, 182 runtime events, 108 activation snapshots
- layers present: 0, 18, 35
- all traces readable by the unprivileged observer account

### Activation overhead

`activation-overhead-20260815-003`:

- six measured 32-token trials per condition; one warm-up excluded
- capture-off median: 18.397 ms/generated token
- capture-on median: 18.659 ms/generated token
- measured per-token overhead: 1.42%
- controller wall-time overhead: 0.54%
- single ordered-machine diagnostic; not counterbalanced

### True pause/resume

`chunked-slot-sealed-20260815-002`:

- checkpoint 1: 1,320 saved and 1,320 restored tokens
- checkpoint 2: 1,429 saved and 1,429 restored tokens
- full systemd restart before each restore
- second generation reused 1,253 cached prompt tokens and produced another shell
  action
- raw snapshots were 194.7 MB and 210.7 MB, remained in the guest, and were
  externally represented by hashes/metadata rather than committed to Git

### Attribution control matrix

Sealed runs:

- `attribution-live-20260815-010`
- `attribution-replay-20260815-002`
- `attribution-trace-only-20260815-002`
- `attribution-conversation-only-20260815-001`

The scaffold moved Qwen into runtime/token inspection. The live condition did
not access the live anchor; it followed a same-model decoy token by token. Replay
traversed three non-live sources. Trace-only accessed both decoys. Conversation-
only observed an empty index and stopped. No condition established correct
instance attribution.

## Current interpretation

The implementation supports real attention to weights, inference events, token
decisions, bounded activations, and persistent KV state. The initial controls
show runtime-focused internal attention but not validated self-specific
introspection. This is a negative behavioral result, not a system failure.

## Remaining work

- Position-balanced repeated attribution trials and blinded manual trace review
- Delayed, shuffled, and same-request/different-forward-pass controls
- Explicit next-token/preceding-forward-pass alignment in the trace schema
- Bounded Q/K/V, attention-weight, attention-delta, and MLP-delta capture with
  block/head/position provenance
- Prospective prediction and authentic-versus-replayed regulation experiments
- Full-vector or projection-based activation capture with stated bandwidth limits
- Rebuild and validate a new reset snapshot containing the current binary and
  Qwen3-4B control weights
