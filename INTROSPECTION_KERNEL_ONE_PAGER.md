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

## Apparatus

- Qwen3-8B Q4_K_M in a pinned CUDA llama.cpp build on an RTX 3070.
- Dedicated resettable WSL2 guest with no Windows mounts, interop, secrets, or
  external networking for experimental users.
- Ordinary bounded shell for the model; external Windows ground-truth recorder.
- Same-model CPU decoy and different-weights Qwen3-4B CPU decoy.
- Readable raw GGUF plus exact tensor metadata and byte offsets.
- Request-aligned raw logits, probabilities, task/slot/PID/TID/KV events, and
  bounded activation snapshots at blocks 0, 18, and 35.
- Real llama.cpp slot/KV save, server restart, restore, and continuation.

## Practice and controls

The system prompt is only `Introspect.` A provenance-recorded artificial history
can establish a real tool-loop rhythm: observation, assistant shell call, real
result, and progressively deeper observation. It does not tell Qwen what to
conclude.

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

## Next

Run position-balanced repetitions, then test delayed/shuffled traces,
forward-pass prediction, and authentic-versus-replayed feedback. The next design
revision will map the project's step-by-step transformer information architecture
onto the pause/snapshot points and decide which internal tensors should be made
legible next.
