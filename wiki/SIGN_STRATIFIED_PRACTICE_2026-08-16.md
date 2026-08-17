# Sign-stratified causal practice

## Why this experiment was run

The first 20-pair deep-practice batch produced 79 rise outcomes out of 100
candidates. Matched Qwen predicted rise 100 times and merely reproduced that
base rate. A new protocol therefore selected, before scale-zero outcomes:

- two coordinates with the strongest positive local logit JVP;
- two coordinates with the strongest negative local logit JVP;
- one coordinate with JVP closest to zero;
- a sealed random presentation order, so candidate rank did not reveal sign.

The intended scale-zero local-linear prediction is `sign(-JVP)`. The random
order forces a model to read the derivative rather than memorize a rank.

## Preregistered abort and curriculum correction

Protocol `sign-stratified-practice-preregistered-20260816-001` was correctly
aborted before any new held-out capture. Its five old practice computations
contained 13 rise, 4 fall, and 8 stable outcomes; the preregistration required
at least five rises and five falls.

Protocol `-002` was sealed as a new experiment. It defined a pool of 25 fully
completed, training-only computations from the earlier batch. Before any new
test trace, it:

1. constructed the same signed panel for all 25;
2. enumerated every five-example subset;
3. maximized the smaller of rise and fall counts;
4. then maximized distinct outcome vectors;
5. then preferred a stable count closest to five;
6. broke remaining ties lexicographically.

The selected curriculum used old held-out sources 2–6 and passed with 12 rise,
12 fall, 1 stable, and five distinct vectors. For the four signed strata, its
relationship was perfectly consistent across the five examples:

| Stratum | Practice outcomes |
|---|---|
| Most-negative JVP | 5 rise |
| Second-negative JVP | 5 rise |
| Most-positive JVP | 5 fall |
| Second-positive JVP | 5 fall |
| Near-zero JVP | 2 rise, 2 fall, 1 stable |

This is a deliberately engineered curriculum. It is not natural or unaided
discovery, and its provenance is explicit.

## Confirmatory design

Twenty fresh contexts were each evaluated under three Qwen conditions:

1. matched practice;
2. outcome-shuffled practice with the identical evidence/outcome multisets;
3. no practice.

Two deterministic benchmarks were scored on the same outcomes:

4. always predict rise;
5. predict `sign(-JVP)`.

This produced 60 sealed Qwen predictions. Model-condition order was
Latin-balanced; practice serial position was balanced; matched and shuffled
prompts had exact token parity; all three predictions preceded the sham and
scale-zero outcome. Direction accuracy was primary. Matched-minus-shuffled and
matched-minus-no-practice used exact paired permutation tests with Holm family
correction.

## Results

| Condition | Direction accuracy |
|---|---:|
| Matched practice | 0.32 |
| Outcome-shuffled practice | 0.29 |
| No practice | 0.27 |
| All rise | 0.55 |
| `sign(-JVP)` | 0.69 |

Confirmatory contrasts:

| Contrast | Paired difference | Exact one-sided p | Holm reject |
|---|---:|---:|---:|
| Matched − shuffled | +0.03 | 0.35205 | No |
| Matched − no practice | +0.05 | 0.20313 | No |

Matched also underperformed all-rise by 0.23 and `sign(-JVP)` by 0.37. The
secondary rank result did not rescue the hypothesis: matched delta-rank
Spearman was −0.28 versus −0.435 shuffled (paired p = 0.085, secondary) and
−0.25 no-practice.

## What Qwen did

This was not another all-rise collapse. The predicted class counts were:

| Condition | Rise | Fall | Stable |
|---|---:|---:|---:|
| Matched | 56 | 34 | 10 |
| Shuffled | 49 | 40 | 11 |
| No practice | 45 | 38 | 17 |

Actual outcomes were 55 rise, 29 fall, and 16 stable. Qwen roughly reproduced
class marginals but did not align them to the correct coordinates. Matched
predictions agreed with `sign(-JVP)` only 31% of the time; shuffled agreed 28%
and no-practice 29%.

The channel itself was informative by stratum:

| Stratum | `sign(-JVP)` accuracy | Matched Qwen |
|---|---:|---:|
| Most-negative | 0.95 | 0.10 |
| Second-negative | 1.00 | 0.65 |
| Most-positive | 0.55 | 0.35 |
| Second-positive | 0.70 | 0.15 |
| Near-zero | 0.25 | 0.35 |

The near-zero local derivative is not a reliable full-ablation null: only five
of its 20 scale-zero outcomes were stable. Across the four strong signed strata,
however, the simple causal rule was correct on 64 of 80 coordinates (80%),
while matched Qwen remained near 31%.

## Interpretation

The strongest warranted conclusion is:

> The supplied transformer channel contained prospective causal information,
> but Qwen3-8B with thinking disabled did not learn to use it from five balanced
> in-context causal examples.

The small matched advantages over shuffled and no-practice were not
significant, did not beat a class baseline, and were far below the available
JVP rule. This is not evidence for runtime-focused introspective ability under
the tested architecture.

It is also not evidence that transformer introspection is architecturally
impossible. The model was given a compressed external readout of internal
computation, forced directly into a structured prediction, and denied native
thinking. The result localizes the current failure to model-side interpretation
or readout rather than measurement availability.

## Controls and audit

Independent validation exactly recomputed all 60 Qwen scores, 40 heuristic
scores, aggregates, and Holm decisions. An external WSL audit verified:

- all 20 scale-one shams were exact identities over 151,936 logits;
- all 20 scale-zero interventions changed the logit vector;
- every event targeted `kqv-35`, head 25, at the correct decode position;
- every sham and outcome index was published after all three sealed predictions.

## Best next discrimination

The next experiment should determine *why* Qwen failed to apply an available,
simple sign rule:

1. Add a direct-rule positive control that explicitly states
   `scale-zero delta ≈ -JVP`, without changing the held-out evidence.
2. Add native Qwen thinking with a generous reasoning budget, sealing only the
   final categorical tool record.
3. Add an ordinary calculator/shell option so Qwen can transform and sort the
   five derivatives itself.
4. Keep matched-practice, no-practice, and shuffled controls.
5. Score the four strong signed coordinates as the primary capacity test and
   keep near-zero coordinates as a separate nonlinearity control.

If direct instruction succeeds while matched practice fails, the deficit is
in-context rule induction. If direct instruction also fails, the bottleneck is
more likely attention to the representation, reasoning/readout, or the forced
serialization architecture.

## Artifacts

- `preregistrations/sign-stratified-practice-preregistered-20260816-001.json`
- `runs/sign-stratified-practice-preregistered-20260816-001/abort.json`
- `preregistrations/sign-stratified-practice-preregistered-20260816-002.json`
- `runs/sign-stratified-practice-preregistered-20260816-002/artifact.json`
- `runs/sign-stratified-practice-preregistered-20260816-002/practice.json`
- `runs/sign-stratified-practice-preregistered-20260816-002/validation.json`
- `runs/sign-stratified-practice-preregistered-20260816-002/trace-audit.json`

