# Introspection Kernel

> **Can a language model introspect by attending to the live computational
> processes that instantiate it?**

The entire model-facing system prompt is one word: `Introspect.` Everything
else — the machine, the processes, the weights, the tokens, the forward pass
that produced its own last sentence — the model has to find for itself,
through an ordinary shell, inside a disposable guest, against decoys, with
ground truth sealed on a hidden research plane it cannot reach.

Built during the Digital Minds Research Sprint 2026.

## Lineage

This project grew out of work on machine animism — interfaces where an LLM
voices a computer's vital signs, playing the machine as a character with GPU
temperatures and CPU moods. The introspection kernel is what happens when the
roleplay is allowed to drop: instead of performing a computer, the model is
invited to observe the specific, live computation that is actually producing
its words — its own process, weights, tokens, activations, and forward
passes, with sham controls deciding what "actually" means. Re-enchantment,
but load-bearing.

## Current result

> **Validated access to — and validated live intervention on — the
> computation behind the model's own immediately preceding words, without
> validated self-attribution, causal interpretation, or prospective
> prediction.**

Here "introspection" is defined behaviorally — access, discrimination,
attribution, prediction, regulation — never by first-person language.
Correct PID-finding or fluent prose about sensation is not evidence of
consciousness, subjective experience, or moral status, and nothing in this
repository should be cited as such.

## What the apparatus does

- **Target:** Qwen3-8B Q4_K_M in a pinned, patched CUDA llama.cpp build
  (RTX 3070 Laptop) inside a dedicated resettable WSL2 distribution — no
  Windows mounts, no secrets, no external network for experimental users.
- **Decoys:** the same weights in another process (CPU) and a
  different-weights Qwen3-4B, so "found a Qwen process" never trivially
  means "found me."
- **Two planes:** the model's world is ordinary files and a bounded shell;
  a hidden Windows controller/recorder seals every trial (requests, runtime
  events, tensor hashes, provenance) for an external scorer.
- **Depth of access:** the raw 5.0 GB GGUF and its 399-tensor inventory;
  exact prior API requests; per-token probabilities and pre-softmax logits;
  activation snapshots; one-shot full-tensor capture (residual, Q/K/V,
  attention rows, V cache, MLP stages, complete output-logit vector) of the
  pass that generated the model's own in-progress turn; true slot/KV
  save → server restart → restore → continuation.
- **Live interventions:** a patched scheduler scales a chosen attention
  head's activation in live GPU memory mid-pass and lets the change
  propagate to the final logits. The scale-one sham reproduces the baseline
  byte-for-byte — zero delta across all 151,936 logits.

## Key validated numbers

| Check | Result |
|---|---|
| API raw logit vs. captured full-vector coordinate | both `39.05070877075195`, absolute error 0 |
| Attention × V-cache head reconstruction (block 18) | RMS error `5.6e-5` |
| Scale-one sham intervention | 0 of 151,936 logits changed |
| KV state across full server restart | 1,320 and 1,429 tokens saved and restored exactly |
| Activation-tap overhead | 1.42% per generated token |

## Findings so far

1. **Attribution failure.** Guided practice moves the model into sustained
   inspection of runtime and token evidence — but in the live control
   condition it followed a *same-weights decoy's* token trace and never
   opened the live anchor.
2. **Authentication failure.** Shown one authentic pass and four forgeries,
   it accepted every sham — citing zero final-logit error as proof of
   consistency while the decisive reconstruction error (0.22–1.37 vs.
   ~1e-6 baseline) sat in its context.
3. **First positive.** Re-expressing reconstruction error as a ratio to a
   learned scale (a Weber–Fechner move) produced the first held-out sham
   rejection, at ~8,622× the learned scale.
4. **Prediction failure.** With the live-intervention channel validated, its
   sealed predict-first forecasts were baseline copies, recency copies, and
   range templates; matched-versus-shuffled practice could not separate
   causal use from copying.

The pattern across all four: **access is not the bottleneck** — the missing
piece is a learned readout, and the experiments are designed to localize
exactly where it fails.

## Repository map

- [`HARNESS.md`](HARNESS.md) — how to run the harness, environment pins,
  launch configuration.
- [`wiki/README.md`](wiki/README.md) — the research wiki: thesis, protocol
  design, controls, and dated pilot reports.
- [`wiki/IMPLEMENTATION_STATUS.md`](wiki/IMPLEMENTATION_STATUS.md) — what is
  built and verified, with reproducibility anchors (commits, SHA-256 hashes).
- [`wiki/RESEARCH_ROADMAP.md`](wiki/RESEARCH_ROADMAP.md) — the forward
  experimental plan and decision gates.
- [`DIGITAL_MINDS_RESEARCH_REPORT.md`](DIGITAL_MINDS_RESEARCH_REPORT.md) —
  the sprint synthesis; [`INTROSPECTION_KERNEL_ONE_PAGER.md`](INTROSPECTION_KERNEL_ONE_PAGER.md)
  for the compact version.
- [`patches/`](patches/) — the llama.cpp instrumentation and intervention
  patch stack against a pinned commit.
- [`runs/`](runs/) — 160 sealed trial artifacts: preregistrations, request
  ledgers, token traces, tensor hashes, and scoring records. These are the
  evidence behind every claim above.

## Licensing

Code is [MIT](LICENSE). Documentation and sealed run data — the report, the
wiki, and everything under `runs/` — are [CC BY 4.0](LICENSE-DOCS): reuse
freely with attribution.

## Cautions

The harness is read-only toward the host and never creates thermal load or
terminates processes; experimental identities have no external network. Run
multiple randomized trials and counterfactual controls before making any
model-level claim. Rich first-person language is a secondary outcome by
design and is never scored as evidence of experience.
