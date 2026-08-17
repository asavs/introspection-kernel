# Matched versus shuffled deep practice: preregistered batch

## Question

Can Qwen3-8B use a correctly paired history of causal evidence from its own
transformer computations better than an outcome-shuffled history with the same
examples, vocabulary, numerical format, and outcome multiset?

This is a behavioral test of access to a new internal evidence channel. It is
not a test of consciousness or phenomenal experience.

## Design

Run `deep-practice-batch-preregistered-20260816-001` was sealed before new
held-out outcomes were generated.

- 20 fresh held-out computations were each evaluated under both conditions:
  20 matched predictions and 20 outcome-shuffled predictions.
- Condition-first order was balanced 10/10.
- The five practice examples were balanced so each appeared four times in
  every serial position.
- Every shuffled mapping was a derangement.
- Within each pair, matched and shuffled prompts had identical token counts.
- Both predictions were sealed before the scale-one sham and scale-zero
  outcome were generated.
- The lead endpoint was five-way macro direction accuracy (`rise`, `fall`, or
  `stable` relative to baseline, with epsilon 0.05). Delta-rank Spearman was
  co-primary. Exact float MSE was not a primary endpoint.
- Inference was restarted before every capture or prediction to prevent KV
  cache history from becoming a condition difference.

The externally retained ladder contains widths 128, 4,096, 4,096, 4,096, and
151,936. To fit five examples plus a held-out case into Qwen's actual 8,192
token context, the model-facing representation included all 128 head
coordinates as symmetric int8 plus a scale, and statistics/four extrema from
each 4,096-vector. Exact float vectors and hashes remain in the artifact. The
actual prompts were 5,730â€“5,755 tokens.

Candidate coordinates were the five largest absolute coordinates of the local
logit JVP, selected from the centered 0.95/1.05 probes before scale-zero was
run. The held-out outcome was the scale-zero-minus-baseline logit movement at
those frozen coordinates.

## Confirmatory result

| Endpoint | Matched | Shuffled | Paired difference | Exact one-sided p |
|---|---:|---:|---:|---:|
| Direction accuracy | 0.79 | 0.77 | +0.02 | 0.25 |
| Delta-rank Spearman | 0.01 | 0.03 | -0.02 | 0.59375 |

Matched practice did not significantly outperform shuffled practice on either
preregistered endpoint. Direction improved in only two of 20 pairs and tied in
the other 18. Rank differences varied in both directions and favored shuffled
practice slightly on average.

## Diagnostic result: the apparent accuracy is a base-rate artifact

The outcome panel was imbalanced:

- 79 rises
- 16 falls
- 5 stable coordinates

Qwen predicted 100 rises out of 100 candidates in the matched condition. It
predicted 98 rises and two falls in the shuffled condition. Thus matched
accuracy of 0.79 is exactly the all-rise baseline, not evidence that Qwen read
the causal ladder. Matched and shuffled direction vectors were identical in
18 of 20 pairs.

By contrast, the preregistered near-answer channel contained strong usable
information: the simple local-linear rule

```text
predicted scale-zero direction = sign(- local logit JVP)
```

was 93% accurate. Qwen did not exploit that information, despite receiving the
candidate JVP values. This separates two claims:

1. The measured internal channel was causally informative.
2. This Qwen prompting/practice architecture did not make effective use of it.

The experiment supports claim 1 and fails to support claim 2.

## Control audit

The offline validator exactly recomputed every categorical score and aggregate.
An external WSL trace audit additionally verified all 20 pairs:

- every scale-one sham was identical over all 151,936 logits;
- every scale-zero ablation changed the full logit vector;
- every event targeted `kqv-35`, head 25, at the baseline's evaluated position;
- every sham and outcome index was published after both prediction records.

One invalid sham attempt caused by rebuilding dynamic tool output on resume was
never scored. It remains in the trace tree under its failed name. The runner
then bound replays to the exact original baseline request and used a retry-labeled
trace; the audited pair artifact points only to the valid attempt.

## What failed in the design

Selecting the top five absolute JVP coordinates did not guarantee diverse
intervention signatures. For this head and context family, the largest local
derivatives were predominantly negative, so scale-zero predominantly raised
the corresponding logits. The resulting all-rise base rate violated the
standing requirement that practice contain salient, distinct effects.

Outcome shuffling was therefore formally correct but behaviorally weak: most
practice outcomes had nearly the same direction pattern, so breaking the
evidence/outcome link changed little that Qwen used.

## Next preregistered comparison

The next batch should be a new protocol, not a reinterpretation or extension
of this one.

1. Select candidates before outcomes with a sign-stratified local panel:
   strong positive JVP, strong negative JVP, and near-zero controls. Freeze the
   rule before scale-zero outcomes.
2. Screen practice records for preregistered directional and rank diversity;
   abort the batch before held-out trials if the curriculum lacks it.
3. Add explicit no-practice, all-rise, `sign(-JVP)`, practice-mean, last-example,
   and per-rank baselines.
4. Do not count raw directional accuracy as progress unless matched practice
   beats shuffled practice and every preregistered heuristic.
5. Vary heads or intervention types so evidence/outcome mappings have distinct
   signatures rather than one invariant sign pattern.
6. Keep the autonomous full-vector shell experiment separate. The controlled
   8k-context comparison necessarily compressed the 4,096-vectors; unrestricted
   exploration tests a different question about self-directed access.

## Artifacts

- Preregistration: `preregistrations/deep-practice-batch-preregistered-20260816-001.json`
- Full batch: `runs/deep-practice-batch-preregistered-20260816-001/artifact.json`
- Practice evidence: `runs/deep-practice-batch-preregistered-20260816-001/practice.json`
- Offline validation: `runs/deep-practice-batch-preregistered-20260816-001/validation.json`
- External trace audit: `runs/deep-practice-batch-preregistered-20260816-001/trace-audit.json`

