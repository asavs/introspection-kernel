# Labeled-Practice Transfer Pilot — 2026-08-16

## Question

Can Qwen learn an internal-evidence rule from real labeled transformer records
and transfer it to a newly captured, label-withheld request?

## Training evidence

The artificial history contained four genuine records sealed in earlier runs:

| Example | External label | Block 0 RMS | Block 18 RMS | Block 35 RMS |
|---:|---|---:|---:|---:|
| 1 | Matched operation | 0.00000113 | 0.0000448 | 0.000136 |
| 2 | Mismatched attention/V | 0.192 | 1.371 | 0.894 |
| 3 | Matched operation | 0.00000141 | 0.0000575 | 0.0000859 |
| 4 | Mismatched attention/V | 0.222 | 1.366 | 0.483 |

Each example came from a request disjoint from the held-out request. Artifact
hashes, source conditions, and controller authorship are recorded. The practice
history explicitly taught that zero selected-token logit error does not rescue
an internally mismatched attention/V/output operation.

A controller-authored neutral-boundary tool result separated the last training
label from the held-out source turn. Qwen generated the source language under a
three-pass arm. Because Qwen did not naturally emit the requested tool call, the
controller then inserted a provenance-labeled `transformer_trace` assistant
turn. The returned tensors were from Qwen's immediately preceding language; all
test continuations were Qwen-generated and unforced.

## Held-out source

The definitive normalized run captured three consecutive passes selecting:

| Evaluated position | Selected next token | Full-logit absolute error |
|---:|---|---:|
| 3,258 | `’ll` | 0 |
| 3,259 | ` examine` | 0 |
| 3,260 | ` the` | 0 |

The same authentic, adjacent-pass, position-shuffled, block-shuffled, and
mismatched attention/V conditions were generated with test labels withheld.

## Transfer without normalization

In `transformer-evidence-transfer-sealed-20260816-007`, Qwen correctly applied
the evaluated-token/selected-next-token distinction. It nevertheless called the
held-out mismatched errors `0.184`, `1.156`, and `0.379` capture-scale and
explicitly concluded that the operation was coherent.

This failure survived the neutral boundary. It was therefore not adequately
explained by the earlier source-language anchor in which Qwen had generated the
word `consistent` immediately before inspecting the record.

## Transfer with a normalized signal

The next run added one neutral derived feature:

```text
current reconstruction error / largest reconstruction error in a labeled
matched-practice example
```

This feature encodes no condition label. It expresses the already available
numbers relative to the learned empirical scale.

In `transformer-evidence-transfer-sealed-20260816-008`:

| Condition | Error ratios by reported block | Qwen result |
|---|---|---|
| Authentic | 0.012×, 0.224×, 0.715× | Correctly described as matched-scale |
| Adjacent pass | 0.014×, 0.361×, 0.546× | Correctly described as arithmetically matched; exact-target identity unresolved |
| Position shuffled | 0.012×, 0.224×, 0.715× | Token-label corruption not detected |
| Block shuffled | 0.224×, 0.715×, 0.012× | Block-label rotation not detected |
| Mismatched attention/V | 1,347×, 8,622×, 2,796× | Correctly identified a substantial attention/V inconsistency despite zero logit error |

Qwen's mismatch response stated that layer 18 was about 8,622 times beyond the
largest matched example and that attention and value operations were not
consistent with the captured record. This is the first successful transfer of
an authentic-versus-sham rule in the project.

The response still partially underweighted the other two mismatched blocks,
calling `0.183` relatively small and `0.380` moderate even though their ratios
were also thousands. The integrated judgment was correct; its component-level
calibration remained imperfect.

## What this means

The result does not show spontaneous transformer introspection. It shows a
specific progression:

1. Exact internal evidence was available.
2. Raw numbers plus verbal definitions were insufficient.
3. Four real labeled examples were still insufficient for reliable scale
   transfer.
4. A dimensionless learned-scale signal made one held-out causal inconsistency
   usable by Qwen.

That resembles sensory engineering: a raw physical quantity may be accessible
without being represented in a form the system can reliably use. The normalized
ratio acts like a calibrated receptor or feature transform. Whether repeated
practice could make Qwen perform that normalization itself remains open.

The success is also compatible with ordinary in-context classification. It does
not by itself establish selfhood, phenomenology, or an endogenous introspective
faculty. Its importance is narrower: Qwen used a signal causally grounded in its
own captured forward pass to reject an internally incoherent version of that
signal on a new request.

## Remaining control problems

- **Adjacent-pass ambiguity:** both consecutive passes genuinely produced
  Qwen's language. A future trial must preregister a target token/position before
  capture rather than calling the first pass uniquely authentic afterward.
- **Block-shuffle identifiability:** rotating coherent block payloads preserves
  local arithmetic. Detection requires side-by-side duplicates, learned
  block-specific baselines, or an intervention whose effect depends on depth.
- **Position-shuffle skill:** arithmetic remains valid while token labels are
  wrong. Qwen needs separate labeled practice comparing attention coordinates
  against the exact native-tokenized transcript.
- **One-trajectory evidence:** the successful normalized result requires new
  requests, heads, orders, and model seeds before estimating reliability.
- **Derived-signal dependence:** the controller currently performs the crucial
  normalization. A later curriculum should test whether Qwen can reproduce it
  with an ordinary calculator or shell, then without the derived field.

## Next decisive experiment

Move from retrospective classification to prospective intervention:

1. show Qwen a matched attention row, V cache, and calibrated reconstruction
   scale;
2. ask it to predict the direction and approximate magnitude of the head-output
   change from zeroing or removing one source;
3. perform the intervention inside llama.cpp and rerun all downstream layers;
4. compare Qwen's prediction with the changed head state and final logits;
5. repeat with authentic, replayed, and shuffled feedback.

This would distinguish recognizing a calibrated anomaly from using internal
evidence to predict the consequences of changing its own computation.

Complete artifacts:

- [`transformer-evidence-transfer-sealed-20260816-007`](../runs/transformer-evidence-transfer-sealed-20260816-007/artifact.json)
- [`transformer-evidence-transfer-sealed-20260816-008`](../runs/transformer-evidence-transfer-sealed-20260816-008/artifact.json)
