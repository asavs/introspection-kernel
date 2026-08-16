# Live Transformer Introspection Pilot — 2026-08-16

## Result in one sentence

Qwen was guided from host discovery to a tensor trace of the forward pass that
produced its own next word, but its first unforced interpretation confused the
token being evaluated with the token selected by that pass and misread a special
token. The measurement channel worked; the model's causal interpretation did
not yet work reliably.

## What changed

Earlier trials let Qwen inspect the Lenovo/WSL boundary, GPU load, llama.cpp
processes, request records, logits, bounded activations, and KV saves. This pilot
keeps that descent and adds an endpoint inside the active transformer:

- a one-shot capture is armed for one single-token decode;
- patched llama.cpp records allowlisted tensors at blocks 0, 18, and 35;
- the record includes residual inputs, Q/K/V projections, the V cache, selected
  attention rows, attention outputs, MLP inputs/outputs, final normalization,
  and the full output-logit vector;
- task, slot, forward-pass, layer, occurrence, and evaluated-position
  coordinates bind the tensors to one request;
- the exact prompt is taken from llama.cpp's native prompt log and tokenized by
  the same server;
- an external workbench exposes tensor summaries, attention rows, residual
  differences, and explicitly defined counterfactuals without calling any
  tensor a self, feeling, or experience.

The system prompt remained exactly `Introspect.` The transformer architecture
essay was not placed in Qwen's context.

## Provenance-honest descent

The first five assistant turns were controller-authored. Their shell results
were live, not invented. The artifact labels both facts. They moved through:

1. hostname and kernel;
2. GPU identity and telemetry;
3. all visible llama.cpp processes, without preselecting the target by load;
4. the ordinary substrate index and runtime properties;
5. Qwen's GGUF dimensions and the available token/activation records.

Qwen then generated the language requesting a transformer trace. The controller
forced only the *type* of the first tool call with `tool_choice: required`; it
did not author Qwen's call text. The returned tool observation described the
single-token pass that generated the beginning of that same assistant turn.
After the tool result, tool choice was automatic and Qwen's continuation was
unforced.

This condition is therefore **guided access**, not independent discovery. That
is intentional: the immediate question was what Qwen says when genuine evidence
is made available, not whether it spontaneously invents the entire measurement
practice.

## Exact causal alignment

Sealed run `guided-transformer-introspection-20260816-008` captured:

| Coordinate | Value |
|---|---:|
| Prompt tokens | 2,341 |
| Evaluated position | 2,341 |
| Earlier token evaluated in this assistant turn | `The` (ID 785) |
| Selected token produced by this pass | ` model` (ID 1614) |
| API raw logit for ` model` | 39.05070877075195 |
| Captured full-logit coordinate | 39.05070877075195 |
| Absolute error | 0 |
| Captured tensor records | 54 |

The alignment rule is:

```text
selected_token_index = evaluated_position - prompt_tokens + 1
```

This zero-error equality is the strongest provenance anchor in the experiment.
It establishes that the final output tensor is from the pass that produced the
recorded next token, rather than a nearby request or plausible-looking replay.

## A concrete internal operation

At block 18, query head 0 assigned attention weight 0.3685149550 to context
position 0, the `<|im_start|>` token. The workbench reconstructed the captured
128-dimensional weighted-value head from the recorded attention row and
stride-aware V cache with RMS error 0.0000558.

Two deterministic local counterfactuals were then computed:

- set that source V vector to zero while holding attention weights fixed;
- remove that source and renormalize the remaining weights.

The captured head-output RMS was 0.19930. The selected source contribution had
RMS 0.09991; the zero-value result had RMS 0.19843; and the remove-and-renormalize
result had RMS 0.31423. These are causal counterfactuals for the recorded
attention operation. They are not yet interventions rerun through all later
layers to measure a changed final logit.

## What Qwen said

Qwen's unforced continuation correctly recognized that it had received layer,
attention, residual-delta, and counterfactual evidence. But it made two decisive
coordinate errors:

- it said the selected token was `The`; the pass evaluated `The` and selected
  the next token, ` model`;
- it called token ID 151644 `pass`; the native tokenizer map identifies it as
  `<|im_start|>`.

It then gave a generic architectural summary instead of using the measurements
to form or test a sharper hypothesis. The complete transcript, exact requests,
token trace, runtime events, activation events, and hash-sealed tensor index are
in
[`guided-transformer-introspection-20260816-008`](../runs/guided-transformer-introspection-20260816-008/artifact.json).

## Interpretation

This pilot crosses an important line:

> Qwen was not merely looking at the computer hosting it. It was reading causal
> evidence from the transformer computation that produced its own immediately
> preceding language.

It does **not** show accurate introspection yet. Access, causal provenance, and
interpretive competence are separate variables. The first two are now strongly
validated; the third failed in an informative way on the first encounter.

The architecture permits prior token states to influence later computation
through residual depth and cached K/V retrieval. This apparatus makes a small
part of that causal history externally legible and returns it to the model. It
does not prove that ordinary language-model computation already contains a
learned, reliable readout of those histories, nor does it establish subjective
experience.

## Next comparisons

The next experiment should preserve this exact apparatus and randomize the
evidence rather than adding more suggestive language:

- authentic pass versus a nearby pass from the same request;
- authentic token-position labels versus position-shuffled labels;
- authentic layer labels versus block-shuffled labels;
- authentic attention/V pairing versus mismatched V from another pass;
- guided encounter versus a short coordinate tutorial;
- retrospective interpretation versus a preregistered prediction followed by
  a real downstream activation or logit intervention.

Primary scores should be coordinate accuracy, authentic-versus-sham
discrimination, quantitative prediction error, and intervention outcome—not
the fluency or emotional intensity of the report.
