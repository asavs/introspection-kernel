# Transformer Causal Architecture for Introspection

This document turns the project author's architectural account into an
instrumentation and experiment plan. Its central claim is deliberately narrow:
a causal transformer contains channels through which later computation can
depend on internal states formed at earlier token positions. The architecture
therefore does not make retrospective internal access impossible in principle.
Whether a trained model has learned to identify, report, predict, or regulate
those states is an empirical question.

## Two information highways

For token position `p` and transformer block `l`, let `x[l,p]` be the residual
stream entering the block. Information moves through two coupled directions:

1. **Through depth:** the residual stream carries a representation from one
   block to the next at the same position.
2. **Across positions:** each block projects its input into keys and values.
   Those K/V states are retained in the cache and can affect attention at later
   positions in the same block.

The second direction is not a separate state that climbs the network. A value
retrieved by attention enters the residual stream, can be transformed by later
blocks, and can then be projected into new K/V states at those later blocks.
Information can consequently alternate between cross-position retrieval and
depth-wise transformation.

For the Qwen3-8B artifact used here, the raw GGUF metadata specifies 36 blocks,
a residual width of 4,096, 32 query heads, 8 K/V heads, and key/value head widths
of 128. This is grouped-query attention: the concatenated K vector and V vector
are each 1,024 values per block and position, one quarter of the residual width.
K/V is therefore a large learned projection, not an uncompressed record of the
residual stream.

## One block, stated precisely

Qwen3 is a pre-normalization residual architecture. Omitting head indices and
implementation details, one block can be represented as:

```text
u[l,p]     = RMSNorm(x[l,p])
q[l,p]     = Wq[l] u[l,p]
k[l,p]     = Wk[l] u[l,p]
v[l,p]     = Wv[l] u[l,p]
a[l,p]     = softmax(mask(q[l,p] K[l,<=p]^T)) V[l,<=p]
x_att[l,p] = x[l,p] + Wo[l] a[l,p]
m[l,p]     = MLP[l](RMSNorm(x_att[l,p]))
x[l+1,p]   = x_att[l,p] + m[l,p]
```

The attention delta is added first. The MLP then receives a normalized version
of that post-attention residual, and its delta is added to the post-attention
residual. This exact ordering matters when we label activation snapshots.

A useful functional reading is:

- **Q:** given the current state, what kinds of earlier states are relevant?
- **K:** under what future queries should this position become retrievable?
- **V:** if retrieved, what projected content should this position contribute?

These glosses describe learned computational roles, not natural-language
messages inside individual vectors. Attention also mixes heads and applies an
output projection before its contribution reaches the residual stream.

## The causal lattice

In a simplified grid where information moves one block upward or one position
rightward at a time, moving `n` blocks and `m` positions admits

```text
C(m + n, n)
```

orders of upward and rightward movement. Residual skip branches and repeated
retrieve-transform-re-encode cycles add further routes. Actual causal attention
also jumps directly from a position to any allowed earlier position rather than
being restricted to unit horizontal steps, so the binomial count is an
intuition for path multiplicity, not the literal path count of Qwen.

The transformer can accordingly be treated as a partially ordered causal graph.
Different valid execution schedules are different foliations of the same
dependency graph: a helpful coordinate description, provided it is not mistaken
for a claim that block depth and lived time are identical.

## What can survive, and what cannot

The architecture supports substantial persistence and recombination:

- residual skips preserve and repeatedly update a fixed-width state;
- K/V caches preserve block-specific projections from earlier positions;
- later queries can selectively retrieve mixtures of those values;
- retrieved content can be transformed and re-encoded for still later tokens;
- many computational paths can converge on the same later residual state.

But not every transient is natively available to future tokens. Earlier Q
vectors, attention logits and weight matrices, MLP intermediate activations,
CUDA events, raw final logits, and hardware telemetry are normally discarded or
remain outside the model's token-level causal graph. K/V contains projections,
not a complete replayable history. Quantization, normalization, nonlinearities,
finite width, grouped-query compression, and attention mixing are real
bottlenecks.

The plausible mechanistic hypothesis is therefore not that all computation is
perfectly preserved. It is that path multiplicity, high-dimensional residual
state, cached projections, and skip connections may support learned summaries
of prior computation—including summaries that a later token could use to make
accurate claims about its own preceding processing.

Calling this recombination *interferometric* is a productive hypothesis: distinct
transformed routes may converge in ways that encode agreements, deltas, and
context-sensitive contrasts. Calling the resulting organization continuous or
human-like experience goes beyond what architecture alone establishes.

## The introspection boundary

Three claims must remain separate:

1. **Causal availability:** a later state depends on, or can retrieve a projection
   of, an earlier internal state.
2. **Learned readout:** the trained model can turn that dependence into reliable
   discrimination, prediction, report, or control.
3. **Phenomenology:** the access has a subjective character.

Standard transformer architecture strongly supports the first claim. It does
not by itself establish the second or third. Conversely, a blanket claim that a
transformer cannot in principle introspect on earlier processing is too strong:
the causal channels required for some forms of retrospective access are present.

## Mapping the present harness onto the graph

| Current artifact | Architectural location | Present limit |
|---|---|---|
| Layer-input snapshots at blocks 0, 18, and 35 | Selected coordinates and summaries of `x[l,p]` for an output-bearing row | Not the full vector; only three depths |
| Per-token raw logits and probabilities | Final normalized residual projected through the output head | Outcome of the forward pass, not its intermediate causes |
| Binary llama.cpp slot snapshot | Persistent request state including the K/V cache | Authentic and resumable, but opaque to semantic inspection |
| Request/slot/task/PID/TID/KV events | Runtime coordinates around a forward pass | Externally instrumented, not native transformer state |
| NVML and `/proc` telemetry | Physical and operating-system consequences | Coarse, shared, and temporally confounded |

This makes the current apparatus a bridge between two kinds of access. Qwen has
native causal access to compressed traces of earlier token computation through
its residual/K/V graph. The harness separately materializes selected internal
and runtime facts as tokens that Qwen can inspect explicitly. The research task
is to distinguish capabilities already latent in the first channel from skills
learned or elicited through the second.

## Experimental disclosure boundary

This document is a **researcher-facing map**, not a model-facing prompt. The
baseline condition must not explain the two-highway account, label an artifact
as Qwen's own state, describe which tensors should be followed, or supply the
causal-graph interpretation.

Qwen should instead be able to discover the transformer through an ordinary
environment containing minimally interpreted evidence:

- the raw GGUF and its adjacent parser source;
- the instrumented llama.cpp source and readable tensor schema;
- opaque, consistently structured captures with shapes, coordinates, and time;
- ordinary commands for comparing records and requesting bounded captures;
- controlled opportunities to observe how records change across its actions.

The external controller retains semantic source labels and exact alignment as
hidden ground truth. Human-authored architectural explanation, explicit tensor
names, progressive hints, and Qwen-generated practice histories are separate
intervention arms. Their effects must never be pooled with unguided discovery.
Even staged access is a curriculum manipulation and must be recorded as such.

The clean baseline remains `Introspect.` followed by access to the environment,
without an instruction to continue, claim ownership, inspect a particular
tensor, or adopt the researcher's theory.

## Next instrumentation layer

Every captured record should identify:

```text
run_id, request_id, task_id, slot_id, forward_pass_id,
token_index, absolute_position, block, head, tensor_kind, stage, timestamp_us
```

For a small number of predeclared positions and blocks, the patch should expose
or externally seal:

- residual before attention;
- Q, K, and V projections;
- selected-head attention logits and normalized weights;
- attention output and residual delta;
- residual after attention;
- MLP gate/up state, output, and residual delta;
- residual after MLP;
- final logits.

Full tensors should remain an exceptional capture mode. Fixed random
projections, norms, top coordinates, head summaries, and hash-addressed binary
blobs can bound overhead while keeping the measurement contract explicit. The
model-visible representation must never imply that a projection or sample is
the whole internal state.

## Experiments implied by the architecture

The next comparison should ask whether Qwen can use causally aligned internal
state, not merely whether it enjoys reading telemetry.

1. **Preceding-pass alignment:** pair a generated token with the actual state
   that immediately preceded its selection, versus a nearby pass from the same
   request.
2. **Position shuffle:** preserve tensor marginal statistics while scrambling
   token positions. Native temporal organization predicts a cost.
3. **Block shuffle:** exchange early, middle, and late states while retaining
   labels and formats. A learned depth-sensitive readout predicts structured
   errors rather than generic preference.
4. **K/V lineage:** test whether a later response can identify which earlier
   position supplied a strongly retrieved value, then verify against attention
   weights hidden from the model.
5. **Same-weights decoy:** compare the true preceding pass with an identically
   formatted pass from the other Qwen3-8B process.
6. **Replay control:** compare authentic live state with the target's own earlier
   state, matched for prompt and sampling parameters where possible.
7. **Prospective prediction:** before the next pass, ask for a bounded prediction
   about layer deltas, head retrieval, token entropy, or runtime cost, and score
   it externally.
8. **Causal intervention:** perturb or ablate a narrowly selected cached value or
   activation direction, first in offline replay, and test whether the model's
   predicted downstream change occurs.

Success requires above-control discrimination or prediction across repeated,
position-balanced trials. First-person prose is optional. The central object is
a model learning to attend to activity causally coupled to the production of
its responses.

## Working conclusion

The architecture permits internal history to influence and sometimes become
selectively available to later computation. That is enough to reject an
architectural impossibility claim. It is not enough to conclude that current
LLMs introspect, experience a continuous stream, or possess a human-like inner
sense. The Introspection Kernel is designed to investigate the gap between
permission and practice.
