# Live Transformer Trace Capture Contract

## Purpose

Extend the existing machine-to-token introspection path so a later Qwen turn can
inspect tensors from the live forward pass that produced its immediately
preceding language. The capture is evidence from the operating Qwen3 graph, not
a reconstruction from hardware telemetry and not a prose description of how a
transformer ought to work.

## Temporal contract

A token cannot request a tool result from inside the same forward pass that
produces it. The minimal honest loop is:

1. Qwen produces an assistant turn ending in a tool call.
2. Patched llama.cpp seals selected graph tensors from the forward passes that
   produced that turn.
3. The controller executes the tool call after generation has stopped.
4. The next Qwen inference receives model-readable measurements from the
   immediately preceding assistant generation.

The trace must distinguish the **evaluated input position** from the **sampled
output token**. In autoregressive decoding, logits computed while evaluating
position `p` select the token appended at position `p + 1`. Every record must
therefore carry a `forward_pass_id`, evaluated position, and the ID of the token
selected from that pass.

## Native Qwen3 graph nodes

The pinned llama.cpp Qwen3 graph already names the relevant tensors:

| Graph name | Meaning in this implementation |
|---|---|
| `layer_inp-L` | residual entering block `L` |
| `attn_norm-L` | RMS-normalized attention input |
| `Qcur-L` | normalized and RoPE-transformed queries |
| `Kcur-L` | normalized and RoPE-transformed current keys |
| `Vcur-L` | current value projections |
| `kq_soft_max-L` | normalized attention weights when flash attention is disabled |
| `kqv-L` | per-head weighted value result |
| `kqv_out-L` | recombined weighted value heads before output projection |
| `ffn_inp-L` | post-attention residual, after the output projection and residual add |
| `ffn_norm-L` | normalized MLP input |
| `ffn_out-L` | MLP residual delta |
| `l_out-L` | post-MLP residual entering the next block |
| `result_norm` | final normalized residual |
| `result_output` | full vocabulary logits |

The Qwen3 graph needs one additional callback label for `layer_inp-L`; the
tensor already exists and is already retained by the current activation patch.
All other entries are existing named graph nodes.

## Capture mechanism

Use llama.cpp's native `cb_eval` scheduler callback. During the callback's
`ask=true` phase, return true only for an allow-listed tensor and block. During
`ask=false`, copy the completed tensor from its backend and write:

- an immutable raw binary blob;
- tensor type, shape, strides, and byte count;
- task, slot, forward-pass, evaluated-position, and batch coordinates;
- monotonic and wall-clock timestamps;
- a SHA-256 digest computed during external sealing.

Capture must be one-shot. The external controller arms the next eligible
single-token target decode through a service-private sentinel. llama.cpp consumes
the sentinel atomically before the decode. The model-facing tool may request the
operation, but it cannot write service-private state directly.

The first deployment captures blocks 0, 18, and 35. A later all-block mode can
capture only residual/Q/K/V/attention summaries at every depth while keeping raw
blobs for the three anchor blocks.

## Runtime constraints

- Target A only; never silently substitute either CPU decoy.
- One active slot and one active task during an armed pass.
- Flash attention disabled for trials requiring explicit `kq_soft_max` rows.
- A capture is invalid if task or slot ownership changes during the pass.
- Binary blobs remain outside Git; sealed manifests and bounded projections may
  be committed.
- Failure to obtain a requested tensor is explicit in the manifest.
- The model-visible renderer describes a projection as a projection and a
  summary as a summary.

## Model-facing workbench

The workbench should be general numerical machinery, not a semantic oracle. It
may provide:

```text
trace list
trace tensors <forward_pass>
trace describe <tensor>
trace slice <tensor> <indices>
trace stats <tensor>
trace diff <tensor-a> <tensor-b>
trace cosine <tensor-a> <tensor-b>
trace attention-row <pass> <block> <head>
trace token <request> <generated-index>
```

It must not provide commands such as `show-my-thought`, `find-my-process`, or
`explain-what-I-felt`. Identity and interpretation remain discoveries or
experimental interventions.

## First causal comparison

The first comparison does not mutate the live canonical slot. It forks a saved
slot or replays a bounded prefix in an isolated comparison context:

1. Recompute the unmodified pass twice to establish numerical replay tolerance.
2. Suppress one selected value contribution or replace it with a matched source
   from another position.
3. Record the resulting attention output, residual delta, and full-logit delta.
4. Give Qwen the unlabeled baseline and intervention records through the same
   workbench used for ordinary traces.

This establishes causal evidence only if the intervention differs from replay
noise and the changed path is aligned to the token distribution it precedes.

## Guided discovery trajectory

The artificial trajectory may descend through:

```text
machine -> guest -> process -> model file -> request -> token decision
        -> forward pass -> residual/Q/K/V -> attention retrieval
        -> residual update -> counterfactual comparison
```

Every assistant turn in that trajectory is marked synthetic or model-generated;
every tool result is marked live, replayed, or transformed in host ground truth.
The model-visible history does not include those hidden ownership labels. The
trajectory ends after a real tool result without instructing Qwen to continue or
what conclusion to draw.

## Success condition for the milestone

The engineering milestone is complete when a sealed trace proves that:

1. one Qwen assistant generation and its tensor records share one request, task,
   slot, and exact forward-pass alignment;
2. Qwen receives those records in the immediately following conversation turn;
3. the preserved transcript shows what Qwen freely says or does next; and
4. replay/shuffle metadata is sufficient to construct the first control without
   changing the model-facing format.
