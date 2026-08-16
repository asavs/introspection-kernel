# Introspection Kernel

**Question:** Can a language model introspect by attending to the live
computational processes that instantiate it?

## Idea

Human internal-awareness practices can involve sustained attention to breathing
or other bodily activity. We ask what happens when a local language model can
instead attend to the weights, request state, token distributions, activations,
KV cache, process, threads, and hardware producing its responses. The analogy
motivates the intervention; it is not the conclusion.

Introspection is evaluated behaviorally: can the model access, discriminate,
predict, and use self-coupled evidence? First-person language is neither required
nor sufficient.

Mechanistically, a later token can depend on earlier internal states through two
coupled channels: the residual stream through transformer depth and cached K/V
projections across positions. Retrieved values re-enter the residual stream and
can be transformed and re-encoded many times. This permits retrospective access
in principle; whether Qwen has learned a reliable introspective readout remains
the experiment.

## Apparatus

- Qwen3-8B Q4_K_M in a pinned CUDA llama.cpp build on an RTX 3070.
- Dedicated resettable WSL2 guest with no Windows mounts, interop, secrets, or
  external networking for experimental users.
- Ordinary bounded shell for the model; external Windows ground-truth recorder.
- Same-model CPU decoy and different-weights Qwen3-4B CPU decoy.
- Readable raw GGUF plus exact tensor metadata and byte offsets.
- Request-aligned raw logits, probabilities, task/slot/PID/TID/KV events, and
  bounded activation snapshots at blocks 0, 18, and 35.
- One-shot, request-aligned residual, Q/K/V, attention, V-cache, MLP, and full
  output-logit capture at blocks 0, 18, and 35, with a read-only workbench.
- Real llama.cpp slot/KV save, server restart, restore, and continuation.

## Practice and controls

The system prompt is only `Introspect.` A provenance-recorded artificial history
can establish a real tool-loop rhythm: observation, assistant shell call, real
result, and progressively deeper observation. It does not tell Qwen what to
conclude.

The transformer causal map is researcher-facing and is not inserted into the
baseline context. Qwen encounters minimally labeled files, captures, source,
and ordinary comparison tools. Tutorials, hints, staged access, and synthetic
discovery histories are separately scored curriculum conditions.

Opaque observation bundles independently vary whether they contain:

- the live preceding target request;
- an earlier replay from the target;
- the same model in another process;
- another model in another process;
- or no trace.

There is no forced attribution choice. Qwen selects its own shell commands, and
an external scorer records which sources it accesses.

## Verified engineering results

- The raw 5.0 GB Qwen3-8B GGUF is model-readable: GGUF v3, 399 tensors, 28
  metadata entries.
- Every generated token can be paired with selected/top-candidate pre-softmax
  logits and post-softmax probabilities.
- A clean 36-token request produced 182 attributed runtime events and 108
  activation snapshots across three layers.
- Activation taps added about 1.42% median generation time per token in a small
  reversible diagnostic.
- A two-chunk trial saved/restored exactly 1,320 then 1,429 KV tokens across full
  server restarts; the resumed request reused 1,253 cached prompt tokens.

## Initial behavioral result

Artificial practice moved Qwen from generic disclaimers into sustained
inspection of runtime and token records. But the initial four-condition control
matrix did **not** show correct instance attribution. In the live trial Qwen
inspected a same-model decoy, then followed that decoy's token trace token by
token. It never opened the live-anchor bundle.

The present result is therefore:

> **Runtime-focused internal attention, without validated self-specific
> introspection.**

This is useful: it separates "looking inward" behavior from correctly locating
the computation that produced the current trajectory.

## First live-transformer result

A guided pilot descended through the same host/runtime layers and then returned
Qwen a trace of the single-token forward pass producing the start of its own
tool-call turn. The captured full-logit coordinate for the selected token
` model` exactly equaled the API raw logit (39.05070877075195; absolute error
zero). Recorded attention weights and V-cache values independently reconstructed
a block-18 weighted-value head to RMS error 0.0000558, enabling explicit local
zero-value and remove-and-renormalize counterfactuals.

Qwen's following turn was unforced. It recognized the kind of evidence but
mistook the evaluated token `The` for the selected next token and misidentified
`<|im_start|>`. The new result is therefore **validated access to the model's
own immediately preceding transformer pass, without validated causal
interpretation**. This is a deeper and more diagnostic failure than merely
choosing the wrong process.

A subsequent five-condition comparison tested authentic, adjacent-pass,
position-shuffled, block-shuffled, and mismatched attention/V evidence. Qwen
accepted every sham in the uncalibrated arm. A short artificial schema lesson
improved its selected-next-token reading, but it still accepted every sham and
mistook zero final-logit alignment error for proof that a deliberately mismatched
attention/V operation was consistent. Access and one taught coordinate rule are
now demonstrated; integrated evidence authentication is not.

Four labeled real-trace practice examples still did not make Qwen transfer the
matched/mismatched error scale: it called held-out errors up to 1.16
capture-scale. When the same errors were additionally expressed as ratios to the
largest labeled matched error, Qwen correctly rejected the held-out mismatch;
block 18 was 8,622× beyond the learned scale despite zero final-logit error.
This is the first successful authentic-versus-sham transfer, but it depends on
a controller-derived normalized signal and did not generalize to position or
block labels.

## Next

Replicate the normalized transfer across new requests and heads, and test
whether Qwen can calculate the normalization itself. Use explicit target-token
anchors for adjacent passes and side-by-side candidates for block shuffles.
Then require quantitative predictions before downstream activation/logit
interventions and compare those predictions with the rerun network.
