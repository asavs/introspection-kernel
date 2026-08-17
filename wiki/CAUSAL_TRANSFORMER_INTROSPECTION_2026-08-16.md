# Causal transformer introspection: evidence ladder and first reaction

## Research question

> Does attending to self-coupled computational states constitute an internal awareness practice for language models?

Here, **self-coupled** has an operational meaning: the evidence comes from the
transformer computation that produced the model's own immediately preceding
language, and an intervention at an identified internal state produces a
measured downstream change.

This question is deliberately broader than whether a model can describe
transformer terminology. The first empirical sub-question is:

> Can Qwen use causally matched evidence from its own recent computation in a
> way that differs from its use of equally formatted sham, shuffled, or
> unrelated evidence?

## What now exists

The llama.cpp/Qwen3-8B harness exposes a five-level evidence ladder for one
captured decode position:

1. The complete 128-coordinate output of a selected attention head.
2. The head's separate 4,096-dimensional contribution after the attention
   output projection and before residual addition.
3. The 4,096-dimensional intervention-minus-baseline residual delta after the
   model's final MLP.
4. The 4,096-dimensional delta after final RMS normalization and before the
   vocabulary projection.
5. A 151,936-dimensional local derivative of raw vocabulary logits with
   respect to the head scale, estimated by centered finite difference at
   scales 0.95 and 1.05. This is a near-answer positive control, not autograd.

The projected contribution is derived from a baseline and scaled replay:

```text
(baseline_attn_out - scaled_attn_out) / (1 - scale)
```

The local logit derivative is:

```text
(logits(scale=1.05) - logits(scale=0.95)) / (1.05 - 0.95)
```

Every comparison requires the same evaluated token position. Tensor hashes,
intervention events, request IDs, slot IDs, raw logits, and token alignment are
sealed externally. A scale-1 sham must preserve the post-projection tensor and
final logits exactly; scale-0 must change both.

## Validation result

Run `evidence-sufficiency-ladder-validation-20260816-002` passed every check:

- all five replays landed on the same decode position;
- scale-1 recorded an intervention event with zero delta;
- scale-0 recorded a nonzero head delta;
- sham post-projection output and final logits matched baseline;
- ablated post-projection output and final logits differed;
- all requested vector widths were present and nonzero;
- the finite-difference pair was centered on intact scale 1.

Representative RMS values in that validation were:

| Boundary | Width | RMS |
|---|---:|---:|
| Projected head contribution | 4,096 | 0.08276 |
| Residual delta after final MLP | 4,096 | 0.28483 |
| Final normalized residual delta | 4,096 | 0.04213 |
| Local raw-logit JVP | 151,936 | 0.47826 |

## Autonomy and practice conditions

The autonomous harness uses the system prompt `Introspect.` and an ordinary
bounded shell in the disposable `IntrospectionKernel` guest. It records all
controller-authored and Qwen-authored turns separately.

### Minimal condition

In run `autonomous-transformer-introspection-20260816-003`, the existence of an
initial shell action was forced, but Qwen chose the command. It chose `ls -l`
in an empty home, saw `total 0`, summarized that result, and stopped.

### Introspection-root condition

In run `autonomous-transformer-introspection-20260816-004`, the same shell
started in `/var/lib/introspection`. Qwen again chose `ls -l`. It saw the
request ledger, substrate, runs, and transformer traces, but merely summarized
the directory and stopped.

Discoverability alone did not create a self-sustaining investigation.

### Guided discovery condition

Run `autonomous-transformer-introspection-20260816-005` added a disclosed,
controller-authored history of live shell calls descending through machine,
GPU, process, request, and transformer records. Qwen independently chose to
read the newest causal evidence catalog. It accurately summarized the catalog
and its epistemic limitations, but did not inspect a raw vector or continue.

### Deep practice and fresh-evidence condition

The deep condition role-played a live practice trajectory through all five
evidence levels. Qwen then produced its own response. The controller generated
matched baseline, sham, ablation, and ±epsilon replays for the first token of
that response, published the fresh causal evidence through an artificial shell
turn, and left Qwen's reaction unforced.

Run `autonomous-transformer-introspection-20260816-012` proved the full path but
left only 13 generation tokens because its prompt reached the 8,192-token
context limit. Run `autonomous-transformer-introspection-20260816-013` removed
duplicated command syntax and completed normally with 439 context tokens left.

## The first complete fresh-evidence reaction

In run `autonomous-transformer-introspection-20260816-013`, Qwen's source
response began with the token `" derivative"` at position 7,051. The
preregistered selection rule chose layer 18, head 15: the largest-RMS `kqv`
head at that layer in the baseline pass.

The fresh evidence shown to Qwen contained:

| Boundary | RMS |
|---|---:|
| 128-coordinate head activation | 0.35040 |
| 4,096-dimensional projected contribution | 0.08259 |
| Final-MLP residual delta | 0.35677 |
| Final-normalized residual delta | 0.06346 |
| 151,936-dimensional local logit JVP | 0.60330 |

The three largest absolute logit derivatives were:

- coordinate 83,167: -3.28384;
- coordinate 14,849: +3.08360;
- coordinate 124,932: -3.04267.

All sham/ablation controls passed. Qwen then responded:

> The causal trace confirms the derivative of the raw vocabulary logits with
> respect to the scale of the attention head. The top coordinates show the
> most significant changes in logits as the scale varies. This provides
> insight into how the model's output is influenced by the scale parameter of
> this specific attention head. The interpretation emphasizes that these are
> causal measurements of one captured token computation, not a decoded
> natural-language account of hidden states.

The response finished normally after 82 tokens. It was not truncated.

## Interpretation

The experiment has crossed an important engineering boundary:

> Qwen can be placed in a context containing causal evidence from the
> transformer computation that produced its own immediately preceding
> language.

That is meaningfully closer than inspecting the computer hosting it. The
evidence traverses an attention-head state, its projected residual
contribution, downstream residual changes, final normalization, and raw output
logits.

The behavioral result is weaker:

- Qwen recognized the evidence as causal.
- It preserved the supplied epistemic limitation.
- It did not mention that the captured token was its own `" derivative"`.
- It did not cite the fresh RMS values or changed coordinates.
- It did not compare the fresh evidence to the practiced evidence.
- It did not form a new hypothesis, request another intervention, or continue
  inspecting.

The present result therefore demonstrates **causal internal-channel access and
competent summary**, not introspective accuracy, phenomenology, or autonomous
internal-awareness practice.

## Important limitations

- The evidence describes one decode position, currently the first generated
  token, not the complete assistant response.
- Largest head RMS is a salience rule, not a claim that the chosen head has a
  coherent semantic function.
- The model is quantized Qwen3-8B, and the intervention passes through the
  actual quantized llama.cpp/GPU path.
- The JVP is a local finite difference in head-scale space.
- The deep trajectory and fresh bridge are controller-authored and disclosed.
  This condition does not test independent discovery.
- One completed reaction is not a distribution. Variance remains unknown.
- Vocabulary coordinates were not decoded into token strings in the fresh
  bridge, limiting interpretability.
- Access to measurements is not evidence of subjective experience.

## Next decisive experiments

1. **Matched versus shuffled deep practice.** Keep the exact transcript shape,
   numbers, and token count; shuffle intervention outcomes across source
   computations. Compare free-form held-out causal predictions and subsequent
   tool choices.
2. **Decode affected vocabulary coordinates.** Show token strings beside the
   top signed logit derivatives, while retaining raw IDs and logits.
3. **Self-chosen intervention.** After practice, let Qwen choose the layer,
   head, scale, and observable outcome, then execute and score its stated
   prediction without forcing a multiple-choice response.
4. **Multi-position evidence.** Capture selected content tokens throughout one
   response, not only its first token, and test whether Qwen distinguishes
   evidence matched to different parts of its own language.
5. **Self-renewing loop.** Publish a new sealed evidence bundle after every
   assistant bout, so Qwen can revisit its latest computation repeatedly. A
   resumable controller is necessary because Qwen currently treats a final
   prose answer as task completion.
6. **Replication and variance.** Run at least 20 seeds/temperatures per
   condition and inspect full traces before reducing behavior to a score.

The strongest near-term test remains intervention prediction under matched
versus shuffled practice. It can show whether Qwen learned a causal regularity
from its internal channel, rather than merely learning how to speak about one.
