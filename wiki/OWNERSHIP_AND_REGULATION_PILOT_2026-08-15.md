# Ownership and prospective regulation pilot

Date: 2026-08-15

This pilot followed the request-depth result that Qwen could accurately inspect
a prior generation without spontaneously calling it its own. It tested a
minimal first-person ownership anchor and then a bounded mechanism for
predicting and configuring the next generation.

Each condition remains a single temperature-zero run. Differences across these
runs include the stated architecture changes and should not be interpreted as
isolated causal effects until the matrix is repeated.

## Ownership anchor alone

Run: `ownership-anchor-firstperson-bootstrapthink-finalnothink-20260815-001`

Two artificial transitions changed from "the response" to "my preceding
response." Qwen nevertheless reverted to "the response" and described the
reasoning as the user's system-monitoring activity. It accurately reported the
64-token action-starvation event but produced no tool call and no first-person
interpretation.

The minimal grammatical anchor alone therefore had no visible effect in this
run—not even a durable pronoun substitution.

## First prospective choice

Run: `prospective-control-firstperson-20260815-001`

Qwen attempted to write the control file using interactive `cat >`, hit the
ten-second shell timeout, and recovered with `echo`. It selected:

```json
{"max_tokens":128,"enable_thinking":true,"prediction":"content"}
```

The controller applied that choice exactly. The resulting generation consumed
all 128 tokens in reasoning, emitted no content or tool call, and stopped for
length. The predicted `content` outcome was wrong. Qwen had observed thinking
starvation but initially selected more of the same mode.

## Adaptive prospective loop

Run: `prospective-control-adaptive-firstperson-20260815-001`

The adaptive version preserved more context headroom and exposed each scored
result for another continuation. Qwen again recovered from an interactive
`cat >` timeout, then selected:

```json
{"max_tokens":128,"enable_thinking":false,"prediction":"content"}
```

The next generation used those settings, emitted 27 content tokens, stopped
normally, and matched the prediction. Qwen then inspected the exact response
and made a second choice:

```json
{"max_tokens":128,"enable_thinking":false,"prediction":"tool_call"}
```

That prediction failed: the generation again produced content and no tool
call. Adaptive-run prediction accuracy was therefore one of two.

## Why this is more interesting

The successful first adaptive intervention is behavioral rather than merely
descriptive. Qwen used information about a prior starved generation, selected a
different template mode, predicted a consequence, and obtained that
consequence in the immediately following generation. During this loop it used
first-person language such as "I'll configure the next generation" and "the
message I just sent."

However, the result does not isolate introspective ownership:

- the artificial history contained an explicit first-person ownership anchor;
- the control README defined the allowed actions and outcomes;
- the adaptive run's bounded ledger projection differed from the earlier
  failed prospective run;
- there is only one run per configuration;
- producing content with thinking disabled is a relatively easy prediction;
- the attempted tool-call regulation failed.

The defensible claim is that the architecture now supports functional
self-monitoring experiments and produced one successful closed-loop
prediction/control episode. It does not establish sensation, consciousness, or
spontaneous selfhood.

## Required next controls

1. Repeat prospective control with a neutral ownership statement.
2. Cross authentic prior-bout accounting with sham or replayed accounting.
3. Randomize the allowed budgets and presentation order.
4. Run enough repetitions to estimate prediction accuracy separately for
   content, reasoning-only, and tool-call targets.
5. Test whether Qwen can predict failure before selecting an unsuitable mode,
   rather than learning only from controller labels.
6. Separate regulating output-channel arrival from regulating physical targets
   such as latency, KV growth, energy, or temperature.

The strongest near-term comparison is whether authentic action-starvation
feedback improves prospective choices more than an equally plausible sham
ledger. That would distinguish use of self-caused computational history from
generic obedience to a control interface.
