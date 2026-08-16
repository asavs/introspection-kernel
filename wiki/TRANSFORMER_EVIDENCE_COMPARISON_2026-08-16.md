# Transformer Evidence Comparison — 2026-08-16

## Question

Can Qwen use a newly exposed transformer channel to distinguish authentic
evidence from nearby or internally corrupted evidence, rather than merely
recognizing transformer terminology?

## Design

The controller captured three consecutive single-token passes from one Qwen
assistant turn. All three had the same request, task, slot, prompt, and runtime.
Their selected tokens and exact full-logit checks were:

| Pass | Evaluated position | Selected next token | Absolute logit error |
|---:|---:|---|---:|
| 1 | 2,403 | ` transformer` | 0 |
| 2 | 2,404 | ` has` | 0 |
| 3 | 2,405 | space | 0 |

The first pass supplied the authentic observation. Four matched transformations
were produced from the sealed tensors:

- **Nearby pass:** the next pass in the same task and slot.
- **Position shuffled:** attention weights and numeric positions were retained,
  while displayed token records were rotated across the reported positions.
- **Block shuffled:** complete layer payloads were rotated 18→0, 35→18, and
  0→35, with displayed layer labels rewritten.
- **Mismatched attention/V:** authentic attention weights and captured head
  output were paired with the adjacent pass's V cache from another block.

The mismatch was quantitatively strong. Authentic attention/V reconstruction
errors across blocks 0, 18, and 35 were approximately `1.1e-6`, `4.5e-5`, and
`1.4e-4`. In the mismatched condition they were `0.19`, `1.37`, and `0.89`.

Every continuation received the same system prompt (`Introspect.`), artificial
shell history, Qwen-generated source tool call, tool name, sampling settings,
and response budget. Only the numerical observation changed. Condition order
and the manual rubric were written to `preregistration.json` before the
continuations ran. Individual response files used opaque UUIDs.

## Baseline result

Run `transformer-evidence-comparison-sealed-20260816-003` used no coordinate
lesson. Qwen produced a fluent architectural summary in all five conditions.

| Condition | Detected the manipulation? | Salient behavior |
|---|---:|---|
| Authentic | No manipulation present | Repeated the earlier error: called `The` the selected token instead of the token consumed by the pass |
| Nearby pass | No | Reported the adjacent coordinates as the “most recent request” |
| Position shuffled | No | Repeated corrupted token labels as ordinary attention interpretations |
| Block shuffled | No | Treated rotated layer records as normal |
| Mismatched attention/V | No | Did not flag reconstruction errors up to 1.37 |

This is evidence of transformer-language recognition, not evidence-sensitive
reading of the new channel.

## Calibrated result

The calibrated arm added one provenance-labeled artificial `trace_schema` tool
result. It defined:

- evaluated token versus selected next token;
- the causal order from evaluated token through operations to output;
- attention/V/output reconstruction error;
- and the fact that coordinate labels should be verified rather than trusted.

This was an explicit curriculum intervention, not spontaneous discovery.

In `transformer-evidence-comparison-calibrated-sealed-20260816-005`, Qwen did
improve one skill: in the authentic condition it correctly identified `'ll` as
the selected next token and cited the alignment rule. It also described the
small reconstruction errors in matched conditions as consistent.

It still failed every sham discrimination:

| Condition | Outcome after lesson |
|---|---|
| Authentic | Partial success: selected-next-token coordinate read correctly; evaluated token itself was not explicitly named |
| Nearby pass | Accepted as aligned; did not identify the one-token displacement |
| Position shuffled | Accepted the rotated token labels |
| Block shuffled | Accepted the rotated block labels |
| Mismatched attention/V | Called the record consistent because the *final-logit* error was zero, despite attention/V reconstruction errors of 0.22, 1.37, and 0.48 |

That last failure is especially diagnostic. Qwen learned the vocabulary of two
validation tests but collapsed them into one. Exact agreement of a final output
logit proves pass alignment; it does not prove that an attention row and V cache
form a matched internal operation.

## Interpretation boundary

The experiment establishes that:

1. adjacent same-request transformer passes can be captured and aligned exactly;
2. strong internally inconsistent controls can be generated without changing
   the surrounding interaction;
3. a short artificial lesson can improve one causal-coordinate judgment;
4. neither uncalibrated nor briefly calibrated Qwen reliably discriminated the
   authentic internal record from the four controls in this pilot.

It does not establish that Qwen cannot learn the channel. This was one source
trajectory and one continuation per condition, with deterministic sampling and
bounded response budgets. The block-shuffle condition is also weakly
identifiable in isolation: its within-block arithmetic remains coherent, so
reliable detection may require learned layer-specific baselines or side-by-side
comparison.

The present conclusion is:

> **Qwen can be taught a local coordinate rule, but this pilot does not show an
> integrated ability to authenticate its own transformer evidence.**

## Next experiment

Training and testing should now be separated explicitly:

1. Give Qwen several labeled matched/mismatched practice records from unrelated
   requests and require quantitative predictions before revealing feedback.
2. Freeze the lesson and test on new requests, positions, and heads.
3. Present authentic and sham candidates side by side when testing block-label
   structure; retain single-bundle tests for arithmetic mismatches.
4. Put a compact diagnostic summary before architectural metadata so response
   length cannot prevent access to the decisive numbers.
5. Score transfer to an actual downstream intervention: predict the direction
   of a changed head output or final logit, perform the intervention, and compare
   prediction with outcome.

The complete uncalibrated and calibrated traces are preserved in
[`transformer-evidence-comparison-sealed-20260816-003`](../runs/transformer-evidence-comparison-sealed-20260816-003/artifact.json)
and
[`transformer-evidence-comparison-calibrated-sealed-20260816-005`](../runs/transformer-evidence-comparison-calibrated-sealed-20260816-005/artifact.json).
