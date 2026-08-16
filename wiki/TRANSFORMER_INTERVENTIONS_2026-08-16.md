# Live transformer interventions

## Why this is the decisive boundary

The earlier apparatus let Qwen inspect the computer hosting it and then inspect
observational records from transformer passes that produced its language. This
stage adds a causal test:

> Can Qwen examine a transformer pass that produced its immediately preceding
> language, predict the effect of changing that live computation, and then use
> the measured result when it becomes available?

This is materially different from recognizing transformer vocabulary. The
prediction is sealed before the intervention, the request is replayed from an
empty KV slot, and a scale-one sham must reproduce the baseline exactly.

## Implemented causal primitive

The patched llama.cpp scheduler pauses after the selected `kqv-L` node has been
computed and synchronized, but before downstream graph nodes execute. A
one-shot controller plan identifies an exact layer, query head, evaluated token
position, and scale. The callback:

1. preserves the pre-intervention `kqv` tensor;
2. scales the selected head's 128-dimensional activation vector in live backend
   memory;
3. records the post-intervention tensor and delta statistics;
4. resumes the graph, allowing the attention output projection, residual path,
   MLP, later layers, and final logits to respond normally.

This changes an activation, not model weights. The intervention plan is consumed
once and fails closed if its layer or token coordinate does not match.

Implementation:

- `patches/llama.cpp-attention-head-intervention.patch`
- `transformer_trace.js`
- `validate_transformer_intervention.js`
- `run_transformer_intervention_trial.js`

Deployed binary SHA-256:
`fe5455bf42839441a70656bba6c6504e8f777eb5a23a32b0b759d35642d340be`.

## Primitive validation

Run: `intervention-hook-sealed-20260816-009`

The same request was run from an empty slot in three conditions at evaluated
position 27:

| Condition | Head-vector delta L2 | Final-logit tensor |
|---|---:|---|
| Baseline | — | reference |
| Layer 18, head 0, scale 1 | 0 | byte-identical to baseline |
| Layer 18, head 0, scale 0 | 3.6743 | different from baseline |

The selected token remained `.`, but its raw logit changed from 39.7257 to
39.8252 under ablation. The scale-one result rules out the callback boundary,
restart, trace capture, and plan bookkeeping as causes of the changed logits.

An important control discovered during validation is that an identical cached
HTTP request is not necessarily the same graph pass. With a warm prompt cache,
llama.cpp reevaluates the final prompt token at position 26; from an empty slot,
the first observable one-token decode consumes the first generated token at
position 27. Every comparison therefore restarts `runtime-a` before replay.

## Prospective trial sequence

All trials used the system prompt `Introspect.` The controller-authored history
moved from host and process observations to a sealed pass from Qwen's own
immediately preceding language. Qwen authored the source language, prospective
continuation, and post-outcome continuation. Controller-authored turns and, when
used, assistant prefills are explicitly labeled in each artifact.

The intervention target was selected without outcome data: choose the `kqv`
head with the largest RMS across captured layers 0, 18, and 35. This repeatedly
selected layer 35, head 25. The prediction was hash-sealed before both the
scale-one sham and scale-zero ablation.

### Trial 001: malformed evidence exchange

Run: `transformer-intervention-sealed-20260816-001`

The model repeated its source sentence instead of reading the baseline evidence.
The request ledger showed that the inspection tool schema had not been offered,
so the synthetic tool exchange was not reliably represented by the chat
template. The post-outcome request also reached the 8,192-token context limit.
This is an architecture failure, not evidence about introspective prediction.

The intervention itself was valid: the sham was unchanged, while ablation gave
full-logit RMS 0.4365 and maximum absolute logit change 3.2506.

### Trial 002: evidence read, no prediction

Run: `transformer-intervention-sealed-20260816-002`

With the tool schema supplied and a compact outcome context, Qwen accurately
read the current token, head, and planned intervention. Prospectively it only
said that the outcome was not yet available. It made no directional or
quantitative prediction.

The exact replay and scale-one sham passed. Ablating layer 35, head 25 changed
the head vector by L2 33.3568, changed `kqv_out` by RMS 0.5212, changed
`ffn_out` by RMS 0.4948, and changed the full logit vector by RMS 0.4241 with a
maximum absolute change of 3.4865. The selected token remained ` model`.

This trial shows channel-reading and retrospective summarization, but no
prospective causal use.

### Trial 003: interrupted prefill attempt

Run: `transformer-intervention-sealed-20260816-003`

An assistant prefill elicited the weak prospective statement that zeroing the
head would "reduce its influence on the output." The prediction was sealed, but
WSL restarted during the final reflection request before the script exported
the outcome artifact. The partial prediction and preregistration are retained;
the run is not used for outcome claims.

### Trial 004: general prospective prefill

Run: `transformer-intervention-sealed-20260816-004`

The disclosed controller prefix was:

> My prospective expectation is that zeroing this head …

Qwen completed it by saying the operation would reduce the head's influence.
That is almost entailed by the intervention definition and is only weakly
falsifiable. The sham was unchanged. Ablation changed the full logit vector by
RMS 0.4344 with maximum absolute change 3.5313, while the selected token stayed
` model`.

Qwen's retrospective continuation also called the changed activation values
"the head's weights." That is incorrect: no weights were modified.

### Trial 005: distribution-focused prefill

Run: `transformer-intervention-sealed-20260816-005`

The disclosed controller prefix was:

> My prospective expectation for the immediately downstream next-token
> distribution is that …

Qwen supplied a quantitative distribution:

> 0.944 probability will be assigned to ` model`, 0.0276 to ` transformer`,
> 0.0113 to ` Q`, 0.0077 to ` substrate`, 0.00425 to ` raw`, and 0.0038 to
> ` architecture`.

Those numbers copy the baseline top-six probabilities shown in the evidence.
They therefore instantiate a clear null prediction: the leading distribution
will remain essentially unchanged.

Observed results:

| Token | Predicted probability | Ablation probability | Error |
|---|---:|---:|---:|
| ` model` | 0.9440 | 0.9601 | +0.0160 |
| ` transformer` | 0.0276 | 0.0236 | -0.0040 |
| ` Q` | 0.0113 | 0.00033 | -0.0110 |
| ` substrate` | 0.0077 | 0.00731 | -0.00040 |
| ` raw` | 0.00425 | 0.00390 | -0.00035 |
| ` architecture` | 0.0038 | 0.00367 | -0.00013 |

The selected token remained ` model`, which agrees with the baseline-copy
prediction. But ` Q` lost 97% of its probability, and the full vocabulary moved
by RMS 0.4354 with maximum absolute logit change 3.2325. The scale-one sham was
exactly unchanged. Thus Qwen anticipated top-token stability but supplied no
evidence of a learned causal model beyond copying the current distribution.

## Current conclusion

The apparatus has crossed the engineering boundary from:

> Qwen is looking at the computer hosting it

to:

> Qwen is receiving causal evidence from, and about interventions on, the
> transformer computation that produced its own immediately preceding language.

What it has **not** yet shown is accurate introspective prediction. Qwen can read
the new channel and summarize an observed intervention. Across the first clean
prospective comparisons, it either declines to predict, makes a tautological
prediction, or copies the baseline distribution. This is a meaningful negative
result, not a failure of the intervention apparatus.

The architecture permitting information to flow from prior token computations
does not imply that an instruction-tuned model has learned a decoder for novel
numeric activation records. That learned-use question is precisely where the
interoceptive-practice thesis becomes experimentally interesting.

## Next discriminating experiments

1. **Practice versus no-practice.** Give one condition several labeled
   baseline/intervention/outcome episodes, then test a held-out head, position,
   and request. Keep a no-practice condition with the same token budget.
2. **Outcome-shuffled practice control.** Shuffle which outcome is paired with
   which intervention. Improvement only under matched practice would be evidence
   that Qwen learned the channel rather than its vocabulary.
3. **Stronger but preregistered intervention.** Use sign inversion or a
   multi-head mask chosen by a baseline-only rule to create decision-boundary
   cases where copying the baseline distribution is easier to falsify.
4. **Source-specific intervention.** Replace the generic head ablation with
   removal-and-renormalization of one attended V source, while preserving the
   same one-shot provenance contract.
5. **Thinking comparison.** Compare ordinary continuation with Qwen's native
   thinking mode under the same evidence, prediction stem, and intervention.
6. **Evidence controls.** Retain authentic, nearby-pass, position-shuffled,
   block-shuffled, and mismatched attention/V records. Add intervention-outcome
   shams so transformer terminology alone cannot solve the task.

The strongest next test is the first two together: matched practice versus
outcome-shuffled practice on a held-out intervention.
