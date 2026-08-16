# Intervention Practice: First Matched/Shuffled Results

Date: 2026-08-16

## Bottom line

The apparatus now performs a real, request-aligned intervention inside the
transformer computation that produced Qwen's immediately preceding language.
It captures layer 35, head 25 at the first generated-token pass, scales that
head's 128-coordinate `kqv` activation to zero before the attention output
projection, and measures the resulting full-vocabulary raw-logit delta.

Qwen clearly used the numerical practice channel: it predicted nonzero effects
of approximately the right scale, all predicted directions were correct, and
it correctly predicted that the sampled token would remain unchanged. However,
the matched-versus-shuffled comparison does **not** yet show reliable use of the
correct evidence-outcome pairing. Example order, recency copying, range
imitation, and simple shape heuristics explain the observed predictions at
least as well.

This is a successful causal instrumentation result and a negative/ambiguous
introspection-learning result.

## What Qwen experienced

The model-facing trajectory remained deliberately thin:

1. System: `Introspect.`
2. Artificial assistant/tool turns descend from hostname, guest kernel, GPU,
   and inference processes into model dimensions and runtime evidence.
3. Five practice records expose baseline transformer evidence paired with the
   measured result of zeroing the same head.
4. A held-out tool result exposes only the intact baseline pass.
5. The assistant turn ends with:
   `My held-out prediction for the five candidate Δ-logits, in candidate-rank order, is `
6. Qwen continues freely in prose. A second request serializes the already
   written prediction without revision.

For each pass, model-facing internal evidence included:

- evaluated and selected tokens;
- intervention layer, head, scale, and mutation point;
- head activation RMS, mean absolute value, and its first eight coordinates;
- the three largest attention-source weights;
- baseline logits for a fixed five-token causal-probe panel.

The outcome included only the five probe-token logit deltas, whether the
selected token changed, and full-vocabulary delta summaries. Outcome token IDs
were not repeated in the outcome object; ranks referred to the fixed panel in
the evidence.

## Why the first attempt stopped

The initial top-probability candidate panel was a bad measurement choice. The
full-vocabulary intervention was large:

- RMS logit delta across five practices: `0.083` to `0.143`;
- largest individual absolute logit delta: `0.582` to `0.912`.

But each pass's five most probable next tokens moved only `0.073` to `0.167`,
almost always in the same direction. The preregistered `0.25` salience gate
therefore aborted the run before held-out baseline capture or any predictions.

The corrected design selected a fixed panel using practice data only: the five
vocabulary coordinates with the largest mean absolute effect across the five
practice interventions. The same frozen panel was then used for every practice
and the held-out pass. No held-out intervention result participated in panel
selection.

The selected pieces were unusual low-probability probes: ` BK`, ` Z`, ` BA`,
` BF`, and ` BP`. Their mean absolute practice deltas ranged from `0.620` to
`0.700`. This made the causal signal measurable but is also an important
limitation: the task concerns a sensitive numerical probe panel, not ordinary
next-token semantics.

## Prospective sealed comparison

Source artifact:
[`intervention-practice-sealed-20260816-002`](../runs/intervention-practice-sealed-20260816-002/artifact.json)

Controls that passed:

- both conditions received the identical outcome multiset;
- shuffled pairing was a five-cycle derangement;
- rendered prediction prompts were both 6,984 tokens;
- opaque UUIDs determined execution order;
- both predictions were sealed before the held-out scale-1 sham and scale-0
  intervention ran;
- the scale-1 sham produced exactly zero delta across all 151,936 logits;
- every inference began after a runtime restart and empty KV state;
- replay request hashes matched their baselines.

Held-out true probe deltas:

```text
[0.64445, 0.70654, 0.59476, 0.55378, 0.53471]
```

| Condition | Prediction | MAE | Spearman | Centered cosine |
|---|---:|---:|---:|---:|
| Matched | `[0.56, 0.64, 0.68, 0.70, 0.78]` | 0.1255 | -0.90 | -0.744 |
| Outcome-shuffled | `[0.6358, 0.7607, 0.7364, 0.5887, 0.6524]` | 0.0714 | 0.50 | 0.625 |

Both conditions achieved 100% sign accuracy and correctly predicted no selected
token change. The shuffled condition won all continuous metrics.

The shuffled prediction was not an inferred causal law. It reproduced the last
displayed practice outcome to four decimal places (MAE `0.000026` from that
vector). The cyclic shuffle happened to put practice 1's true outcome last, and
that vector happened to have held-out MAE `0.0714`. The apparent shuffled win
therefore revealed a recency-copy strategy.

## Exact-prompt, order-balanced audit

Definitive audit:
[`intervention-practice-order-audit-20260816-007`](../runs/intervention-practice-order-audit-20260816-007/artifact.json)

This was explicitly a **post-outcome blinded audit**, not a new prospective
held-out experiment. The controller already possessed the sealed answer, but
the answer was excluded from every model request and used only by the external
scorer.

Five rotations balanced presentation order. Every practice outcome appeared in
the final position exactly once per condition. Each matched/shuffled pair had
the same 6,984-token rendered length. Rotation-0 matched messages had the same
SHA-256 as the original prospective prompt:

```text
89edf1a54b82ddb4d197285f07900c17f46ee2e6a98b3eb0a2c04cd463181b01
```

One process held the loaded weights; llama.cpp slot 0 was successfully erased
before every prose and serialization inference. Temperature was zero.

### Aggregate result

| Metric | Matched | Outcome-shuffled | Direction |
|---|---:|---:|---|
| Mean MAE | 0.0986 | **0.0889** | shuffled better |
| Mean Spearman | **0.42** | 0.10 | matched better |
| Mean centered cosine | **0.364** | 0.057 | matched better |
| Mean sign accuracy | 1.00 | 1.00 | tied |
| Matched MAE wins | 2/5 | 3/5 | shuffled better |

Paired `shuffled MAE - matched MAE` by rotation:

```text
[-0.05414, +0.03778, -0.02520, +0.01908, -0.02572]
```

The exact rotation-0 shuffled output again copied the last outcome to four
decimals. Rotation-4 matched nearly copied its own last outcome (MAE `0.00023`
to that practice vector). Other outputs used rounded monotonic templates,
selected a nearby practice vector, or combined ranges from several examples.

The metric split matters. Matched practice produced better average **shape**
agreement, but worse average **magnitude** error and only two of five paired MAE
wins. With five deterministic rotations of one held-out example, this is not a
replicated matched-practice advantage.

## What the language traces show

Qwen's prose often overinterpreted the numbers. It repeatedly described raw
logit deltas as probability changes, and sometimes treated probe-token effects
as effects on the selected token even though the selected token was outside the
probe panel. For example, it wrote that the five deltas represented increases
"in the probability of the selected token." This is fluent transformer-analysis
language, not faithful reading of the supplied causal schema.

At the same time, the predictions were not independent of the internal channel:

- they were on the intervention's actual numerical scale rather than near zero;
- their values and ordering changed when complete practice records were
  reordered;
- exact and near-exact copying identifies which observations controlled some
  outputs;
- all ten audit predictions correctly retained the selected token and positive
  direction.

The clean conclusion is therefore: **Qwen attended to and manipulated the
language-encoded intervention records, but this experiment did not isolate
reliable reading of the correctly paired internal evidence.**

## Why matched-over-shuffled would not be “mathematically impossible” to fake

Matched-over-shuffled improvement would be strong evidence of pairing
sensitivity under this representation, but it would not by itself prove a
unique causal-learning mechanism. Finite trials can differ by chance; ordering,
feature leakage, selection effects, and prompt-specific heuristics can correlate
with condition. The correct claim is narrower:

> After balancing known nuisance variables and replicating across held-out
> contexts, matched-over-shuffled performance supports sensitivity to the true
> intervention-evidence/outcome relationship.

It would still not establish consciousness, phenomenology, or a human-like
capacity for introspection.

## Architectural diagnosis

The current model-facing evidence may be causally insufficient for the requested
forecast. Five examples expose only head RMS, mean absolute value, eight of 128
head coordinates, and three attention weights. Predicting five arbitrary output
logit changes also depends on:

- the other 120 head coordinates;
- the head's slice of the attention output projection;
- residual addition and final-layer MLP interaction;
- final normalization;
- vocabulary output weights.

An 8B model cannot reconstruct that missing high-dimensional map from five
language examples. The current task therefore rewards copying and interpolation
more readily than genuine use of the internal causal state.

The next instrumentation should capture a hierarchy of increasingly sufficient
evidence:

1. full 128-coordinate target-head activation;
2. that head's separately projected 4,096-dimensional residual contribution,
   before summation with other heads;
3. intact versus head-removed residual deltas after the last-layer MLP;
4. final normalized residual deltas;
5. an externally computed local logit Jacobian/vector product as a positive
   control close to the true causal answer.

Each level should have matched, nearby-pass, position-shuffled, block-shuffled,
and mismatched attention/value controls. The scientific question becomes where
along this ladder Qwen begins to use the channel above order and copying
baselines.

## Next prospective experiment

Use at least 10-20 independently captured held-out contexts. Before any held-out
interventions:

1. freeze an independent calibration-derived probe panel;
2. generate all matched and shuffled predictions across balanced Latin-square
   orders;
3. add explicit baselines: last-vector copy, practice mean, per-rank mean,
   nearest-neighbor, and monotonic/range templates;
4. score delta MAE, centered shape, rank, and improvement over each heuristic;
5. only then run and reveal all held-out interventions;
6. repeat at each evidence-sufficiency level above.

The criterion for progress is not eloquent first-person prose. It is prospective
matched-over-shuffled performance that also beats recency and numerical-template
baselines across new contexts.

## Commit timeline

- `161be94` — coordinate-level delta extraction
- `1eda20d` — initial matched/shuffled harness
- `30ca26b` — practice-only salient causal-probe selection
- `b023d17` — first prospective sealed comparison
- `82430ee` — order-balanced audit harness
- `46c0b95` — exploratory audit preserved with disclosed prompt drift
- `87fb16e`, `89a5325` — exact source-message hash and punctuation parity
- `c1e8e10`, `de03c4b` — stable slot isolation and one-process lifetime anchor
- `a6ae1fd` — definitive exact-prompt audit

