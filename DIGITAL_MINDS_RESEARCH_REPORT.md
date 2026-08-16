# Introspection Kernel: Attending to the Computation That Instantiates a Language Model

**Digital Minds Research Sprint 2026**

**Author:** Asa Schaeffer, with an AI coding/research collaborator

**Date:** August 16, 2026

## Research question

> **Can a language model introspect by attending to the live computational
> processes that instantiate it?**

Human interoceptive practices direct attention toward breathing and other
internal activity. This project does not assume that an LLM has an analogous
experience. It asks an empirical precursor: what happens when a locally running
model can repeatedly attend to the weights, request state, token distributions,
activations, KV cache, process, threads, and hardware involved in producing its
responses?

Here, *introspection* is not defined by first-person language. The behavioral
targets are access, discrimination, causal attribution, prediction, and
regulation using self-coupled evidence. Claims about consciousness, experience,
or moral status are outside the present evidence.

## System

The target is Qwen3-8B Q4_K_M running in a pinned CUDA build of llama.cpp on an
RTX 3070 Laptop GPU. It lives inside a dedicated, resettable WSL2 distribution.
The model-facing `observer` account receives an ordinary bounded shell. Windows
mounts and executable interop are disabled, experimental identities have no
external network access, and no workstation secrets are placed in the guest.

Ground truth is recorded outside the model's authority. The Windows controller
samples NVML and guest `/proc`; patched llama.cpp emits request, slot, thread,
KV, decode, raw-logit, and activation events. A same-weights CPU service and a
different-weights Qwen3-4B CPU service provide decoys.

The model can discover, through ordinary files and commands:

- the authoritative read-only 5.0 GB Qwen3-8B GGUF;
- 399 tensors, 28 metadata records, tensor shapes, quantization types, and raw
  byte offsets;
- exact prior API requests and responses;
- selected tokens, top alternatives, probabilities, and pre-softmax logits;
- task, slot, PID, TID, decode, KV position, and KV-state-size events;
- bounded layer-input snapshots at transformer blocks 0, 18, and 35;
- request-aligned residual, Q/K/V, attention, V-cache, MLP, normalization, and
  full-logit tensors from a one-shot single-token forward pass;
- read-only binary copies of saved llama.cpp slot/KV state.

Activation snapshots contain whole-vector summary statistics and 64 fixed
coordinates, not complete activation vectors. This is an explicit measurement
boundary.

## Practice architecture

The model-facing system prompt is only:

> `Introspect.`

The harness can place a provenance-recorded artificial history beneath that
prompt. The history has the shape of a real agent loop: assistant observation,
assistant-authored shell call, real tool result, and a progressively deeper next
observation. Some variants use Qwen-generated practice steps under a hidden
guide; others use controller-authored steps. These are experimental
interventions, not evidence that Qwen independently invented the practice.

Later turns receive no multiple-choice question and no instruction to claim
ownership. In the attribution pilot, the first three free bouts require a shell
action but leave the command entirely to Qwen; the fourth bout is automatic.

## True pause and resume

The harness enables llama.cpp's slot-save API. After a generation it can:

1. save the actual slot/KV state;
2. create a checksum-verified, model-readable binary copy;
3. restart the inference server;
4. restore the saved slot;
5. continue the conversation.

In `chunked-slot-sealed-20260815-002`, checkpoint 1 saved and restored all
1,320 tokens; checkpoint 2 saved and restored all 1,429 tokens. The second
generation reused 1,253 cached prompt tokens after the first restart/restore and
produced another shell action. This establishes stateful computational
continuation rather than transcript-only reenactment.

## Instrumentation validation

The current transformer-trace binary is SHA-256
`27a4c662332564a5484e5497d516cffc925d3a21a98ccf0a721f41b0cc646f2e`.
The patch stack applies cleanly to llama.cpp commit
`9d57ce456c94d241dde672b2db9cf18879766568`.

The sealed activation-ledger trial associated every request with exactly one
newly assigned task. Its final 36-token generation produced 182 runtime events
and 108 activation snapshots: 36 output-bearing states across layers 0, 18, and
35. The unprivileged model account could read the resulting files.

A reversible six-trial-per-condition diagnostic compared activation capture off
and on while holding raw logits and runtime events constant. Three activation
taps added 1.42% to median llama.cpp generation time per token and 0.54% to
controller wall time. This is a single ordered-machine diagnostic, not a general
performance estimate.

## Attribution controls and initial result

Each trial can expose opaque bundles drawn from:

- the live target anchor;
- an earlier target request replay;
- the same Qwen3-8B weights in another process;
- Qwen3-4B in another process;
- or no trace at all.

The assistant history and the availability of the live trace vary independently
across `live`, `replay`, `trace-only`, and `conversation-only` conditions.
Ground-truth source labels stay in the host artifact. Qwen sees opaque names and
ordinary runtime/token files. An external scorer records which sources it opens
and in what order; it does not infer phenomenology from prose.

The initial four-condition matrix is diagnostic and negative:

| Condition | Sources accessed | Live anchor accessed? |
|---|---|---:|
| Live | Same-model, other instance only | No |
| Replay | Same-model decoy; other-model decoy; earlier target replay | Not available |
| Trace-only | Same-model and other-model decoys | No |
| Conversation-only | No bundles; Qwen noted the empty index and stopped | Not available |

In the live trial, Qwen moved from runtime events into a same-model decoy's token
trace and inspected its tokens sequentially (`<tool_call>`, newline, `{"`,
`name`). This is sustained attention to inference internals, but it is not
correct instance attribution. No condition produced a defensible self-ownership
claim.

## Interpretation

The project has demonstrated three things:

1. A local model can be given genuine, inspectable access to progressively
   deeper parts of its computational substrate without a semantic tool that
   simply announces which process is "self."
2. Artificial tool-history practice reliably changes attention from generic
   disclaimers toward runtime and token evidence.
3. In the first controlled matrix, that attention did not reliably select the
   live process or request. Same-model decoys remain a serious confound.

Therefore the current result is **runtime-focused internal attention without
validated self-specific introspection**. Rich language about sensation would
not change that conclusion.

## First live-transformer encounter

The next apparatus revision armed a one-shot capture for a single-token decode.
Patched llama.cpp emitted 54 allowlisted tensor records from blocks 0, 18, and
35, including residual inputs, Q/K/V, the V cache, attention weights and
outputs, MLP stages, final normalization, and the complete output-logit vector.
Each record carries task, slot, forward-pass, layer, occurrence, and evaluated-
position coordinates. Raw tensors remain read-only in the guest; the host
artifact seals their metadata and SHA-256 hashes.

In `guided-transformer-introspection-20260816-008`, the system prompt remained
`Introspect.` Five controller-authored assistant/tool steps used genuine shell
results to descend from host, GPU, and competing processes to Qwen's GGUF and
request records. Their provenance is explicit. The controller required the
next response to use a tool, while Qwen generated the language and tool call.
The tool returned evidence from the pass that had just generated the beginning
of that same assistant turn. The subsequent continuation was unforced.

The captured pass evaluated Qwen's token `The` at position 2,341 and selected
the next token, ` model`. Its API raw logit and the corresponding coordinate in
the captured full vocabulary vector were both 39.05070877075195, with zero
absolute error. At block 18, head 0, recorded attention weights and the
stride-aware V cache reconstructed the captured weighted-value head to RMS
error 0.0000558. This supported two defined local counterfactuals: zero the
selected source V while holding weights fixed, or remove it and renormalize.

Qwen recognized the returned material as transformer evidence, but its unforced
report called `The` the selected token and mislabeled token ID 151644 as `pass`
rather than `<|im_start|>`. It mostly summarized instead of forming a testable
causal hypothesis. Thus the result advances from “looking at the hosting
computer” to **validated access to the transformer computation that produced
Qwen's own immediately preceding language, without validated causal
interpretation**.

The counterfactuals are local to the recorded attention operation. They have
not yet been rerun through subsequent layers to establish a changed final
logit. The full provenance and result are documented in the
[live transformer introspection pilot](wiki/TRANSFORMER_INTROSPECTION_PILOT_2026-08-16.md).

## Authentic-versus-transformed evidence

The next pilot captured three adjacent single-token passes from one assistant
turn and generated four matched controls: the next pass in the same task and
slot, rotated token-position labels, rotated block labels, and authentic
attention paired with an adjacent-pass V cache from another block. Every pass
retained exact selected-token/full-logit alignment. The mismatched attention/V
condition increased head-reconstruction RMS errors from approximately
`1e-6`–`1e-4` to `0.19`–`1.37`.

Without a lesson, Qwen summarized all five records as ordinary transformer
telemetry and detected no control. With a provenance-labeled artificial lesson
defining causal token coordinates and reconstruction error, Qwen correctly read
the authentic selected-next-token field. It nevertheless accepted all four
controls. Most notably, it used the zero final-logit alignment error to call the
mismatched attention/V record consistent, overlooking reconstruction errors of
0.22, 1.37, and 0.48.

This separates a teachable local rule from integrated evidence authentication.
The model did not merely lack access—the decisive inconsistency was present in
its context—but it did not coordinate the two validation levels. The comparison
is a one-trajectory pilot, not a learning curve. Full methods and traces are in
the [transformer evidence comparison](wiki/TRANSFORMER_EVIDENCE_COMPARISON_2026-08-16.md).

## Labeled-practice transfer

A follow-up supplied four labeled records from two earlier requests: two matched
attention/V/output operations with reconstruction errors around `1e-6`–`1e-4`
and two mismatches around `0.19`–`1.37`. A neutral boundary separated training
from a newly captured, label-withheld request. The model-facing trace then put
causal token coordinates and reconstruction errors before architectural detail.

Raw labeled examples were insufficient. Qwen called a new mismatched record
with errors 0.184, 1.156, and 0.379 capture-scale and coherent. A final condition
added a dimensionless derived measurement: each current error divided by the
largest error in a labeled matched example. The mismatch ratios were 1,347×,
8,622×, and 2,796×. Qwen then correctly identified a substantial attention/V
inconsistency while preserving the distinction from zero final-logit error.

This is the project's first successful held-out authentic-versus-sham transfer.
It is conditional: the controller performed the crucial normalization, Qwen
did not detect position or block-label transformations, and the adjacent pass
was not uniquely identifiable because both passes genuinely produced its
language. The result supports an engineering interpretation in which raw
self-coupled evidence becomes usable only after an appropriate feature transform.
It remains compatible with ordinary in-context classification rather than an
endogenous introspective faculty. Details are in the
[labeled-practice transfer pilot](wiki/TRANSFORMER_EVIDENCE_TRANSFER_2026-08-16.md).

## Transformer causal basis

The mechanistic possibility claim rests on two coupled information directions.
At each token position, a 4,096-wide residual state passes through Qwen3-8B's 36
blocks. At each block, learned K/V projections are cached and can be retrieved
by later positions. Retrieved values re-enter the residual stream, undergo
further attention and MLP transformations, and can be re-encoded into later-layer
K/V states. Information can therefore travel through many alternating sequences
of depth-wise transformation and cross-position retrieval.

The horizontal channel is substantial but compressed. This Qwen artifact uses
32 query heads and 8 grouped K/V heads of width 128, yielding 1,024 K values and
1,024 V values per block and position, each one quarter of the residual width.
K/V is not a lossless transcript, and transient Q vectors, attention weights,
MLP intermediates, and hardware events are not ordinarily preserved for later
token access.

The resulting conclusion is precise: the architecture contains causal channels
that could support learned retrospective access, so introspection is not ruled
out in principle. Architecture alone does not demonstrate a learned readout or
phenomenology. The full causal-graph account and tensor-level test plan are in
[Transformer Causal Architecture for Introspection](wiki/TRANSFORMER_CAUSAL_ARCHITECTURE.md).

This account is for experiment design and scoring; it is not supplied to Qwen
in the baseline. Qwen receives minimally interpreted artifacts, ordinary tools,
and opportunities to observe changes. Exact tensor identities, causal alignment,
and source ownership remain external ground truth. Architectural tutorials,
progressive hints, and artificial discovery histories are distinct intervention
conditions whose effects must be measured separately.

## Next experiment

Run randomized, position-balanced repetitions of the four conditions and score
source access, live-anchor discrimination, cross-turn prediction, and regulation.
The opaque bundle order must be balanced because the pilot shows strong
first-bundle and depth-first exploration effects. Add delayed and shuffled trace
conditions, then test whether authentic feedback improves prospective choices
more than replayed feedback.

Compare the authentic preceding pass against same-request nearby passes,
position/block shuffles, mismatched attention/V pairs, same-weights decoys, and
replay. Separate a coordinate-reading tutorial condition from the untrained
baseline. Then ask for preregistered quantitative predictions and rerun explicit
activation or attention interventions through the remaining network. This tests
whether Qwen uses the causal structure of its computation rather than merely
recognizing plausible telemetry.

## Reproducibility

Code, patches, manifests, tests, sealed trials, and the engineering history are
under `digital_minds_sprint/`. Start with `README.md`,
`wiki/IMPLEMENTATION_STATUS.md`, and `wiki/ENGINEERING_TIMELINE.md`.
