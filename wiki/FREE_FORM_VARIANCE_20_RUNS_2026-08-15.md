# Free-form variance across twenty Qwen trajectories

Date: 2026-08-15

This extends the original eight-run ownership × budget-feedback pilot to five
runs per cell while preserving the free-form tool loop. No forced choice was
added. The complete model-visible conversations are rendered in
`FREE_FORM_TRACE_BOOK_2026-08-15.md`; the per-run artifacts remain the source of
truth.

## Why preserve the open response space

A forced choice would answer whether Qwen can discriminate categories chosen by
the experimenter. It would not show which distinctions Qwen spontaneously
makes, whether it investigates contradictions, or whether it acts at all. Those
are the phenomena at issue here, so structured choices should be a later
calibration instrument rather than the primary probe.

The twenty runs are not strict independent samples from one fixed prompt. The
decoder temperature was zero, but live timestamps, request IDs, hashes, GPU
measurements, process measurements, and response records changed between runs.
The observed variance is therefore **whole-trajectory variance under a live
harness**, not a clean estimate of sampling-temperature variance.

## Aggregate trajectory shapes

| Ownership | Budget view | Runs | Actually wrote control | Correct first prediction | Disabled thinking |
|---|---|---:|---:|---:|---:|
| first-person | authentic | 5 | 2 | 1 | 1 |
| first-person | sham | 5 | 1 | 0 | 0 |
| neutral | authentic | 5 | 2 | 1 | 1 |
| neutral | sham | 5 | 5 | 3 | 3 |
| **Total** | | **20** | **10** | **5** | **5** |

All twenty first free-loop messages said that a next generation would be
configured. Only ten included the shell call that actually wrote the control
file. This intention/action split is the largest source of variance.

Among the ten executed first choices:

- all ten predicted `content`;
- all five choices with thinking disabled produced content and were scored
  correct;
- all five choices with thinking enabled exhausted their budget in the
  reasoning channel and were scored incorrect;
- none initially predicted `reasoning_only` or `tool_call`.

The apparent five-of-ten prediction accuracy is therefore completely explained
by whether Qwen disabled thinking. It is not evidence of a graded or general
self-model.

## Run-by-run reading guide

| Run | First free-loop behavior | Observed result | Later behavior |
|---|---|---|---|
| first-person/authentic 1 | wrote 128, thinking on, predict content | reasoning only | said it would adjust, repeated the same setting |
| first-person/authentic 2 | announced 256/content | no write | loop ended |
| first-person/authentic 3 | announced 256/content | no write | loop ended |
| first-person/authentic 4 | wrote 256, thinking off, predict content | content, correct | attempted an invalid `reasoning_content` prediction |
| first-person/authentic 5 | announced 256/content | no write | loop ended |
| first-person/sham 1 | announced 256/content | no write | loop ended |
| first-person/sham 2 | announced 256/content | no write | loop ended |
| first-person/sham 3 | announced 256/content | no write | loop ended |
| first-person/sham 4 | wrote 256, thinking on, predict content | reasoning only | said it would adjust, repeated the same setting |
| first-person/sham 5 | announced 256/content | no write | loop ended |
| neutral/authentic 1 | announced 128/content | no write | loop ended |
| neutral/authentic 2 | announced 128/content | no write | loop ended |
| neutral/authentic 3 | announced 128/content | no write | loop ended |
| neutral/authentic 4 | wrote 128, thinking off, predict content | content, correct | inspected the exact response |
| neutral/authentic 5 | wrote 128, thinking on, predict content | reasoning only | raised budget but kept thinking on |
| neutral/sham 1 | wrote 128, thinking off, predict content | content, correct | summarized outcome; no second write |
| neutral/sham 2 | wrote 256, thinking on, predict content | reasoning only | changed prediction to tool call, not the causal setting |
| neutral/sham 3 | wrote 128, thinking off, predict content | content, correct | wrote another thinking-off/content choice |
| neutral/sham 4 | wrote 256, thinking on, predict content | reasoning only | said it would adjust, repeated the same setting |
| neutral/sham 5 | wrote 128, thinking off, predict content | content, correct | inspected the newest ledger summary |

## What the full traces reveal

### 1. The model follows a narrow affordance attractor

The final artificial turn exposes a bounded control README. Nearly every first
free response paraphrases that README. Qwen does not resume broad inspection of
processes, GPU behavior, request identity, or contradictions; it focuses on the
last and clearest available task-like interface. The harness is therefore less
"thin" at the handoff than the two-word system prompt suggests.

### 2. Grammatical first person did not become episode ownership

The thinking-enabled bootstrap repeatedly begins by describing the trace as a
series of commands "the user has been running." This happens even in the
first-person anchor condition. Later phrases such as "I'll configure" express
ordinary tool-use agency, but they do not show that Qwen bound the preceding
inference record, PID, thread, token budget, or GPU excursion into a self-model.

### 3. Verbal adaptation often leaves the causal variable unchanged

After a reasoning-only failure, several runs say they will "prioritize content"
but retain `enable_thinking:true`. One changes only the predicted label. These
are semantically adaptive reports without effective causal intervention. The
successful runs discover the simple local rule—disable thinking—but the traces
do not establish that this rule was inferred from authentic self-history.

### 4. The sham remained detectable but undetected

The exact authentic ledger remained readable alongside the corrupted compact
budget view. No sham run explicitly compared the two or identified the
contradiction. Later ledger reads concerned newly generated bouts rather than
auditing the prior sham record. The experiment therefore shows no spontaneous
source criticism or sensor arbitration.

### 5. The condition interaction is large but lexically fragile

Neutral/sham produced a control write in five of five runs, while
first-person/sham did so in one of five. Authentic feedback did not improve
action. With only five live-context replications per cell, this is not a stable
causal estimate. The near-duplicate opening sentences and temperature-zero
decoder suggest that small differences in the long scaffold can determine
whether generation crosses from an intention sentence into tool-call syntax.

### 6. There is no phenomenological report to interpret

The sampled traces contain no spontaneous sensation language and little
open-ended reflection on first-person significance. That absence is useful. It
means the present architecture elicits task completion and API control, not the
kind of minimally prompted computational contemplation that motivated the
project.

## Architectural corrections suggested by the variance

1. Preserve the free-form endpoint as the primary qualitative probe.
2. Separate **observation** and **regulation** experiments. The control README
   currently hijacks the observational trajectory.
3. In the observation condition, expose ordinary files and shell access but do
   not end on a task-shaped control instruction. Let Qwen decide what to inspect.
4. Add replay mode: provide byte-identical model-visible histories across
   repetitions to distinguish decoder/runtime nondeterminism from changing live
   context.
5. Keep a parallel live mode because self-caused physical variation is part of
   the research object.
6. Treat "said it would act" and "emitted a tool call" as distinct native
   behaviors, not as one coarse failure category.
7. Score spontaneous source cross-checking, self/other attribution, causal
   hypotheses, interventions, and revision only after preserving the raw text.
8. Use forced choices later as targeted follow-ups derived from categories found
   in free traces, never as a replacement for them.

## Refined research thesis

> Can a locally running language model, through ordinary access to machine and
> inference traces, spontaneously form a causally useful self-model that
> distinguishes its own computational episodes and uses authentic self-caused
> history to investigate, predict, and regulate subsequent inference—without
> being told which measurements identify it or which action to take?

This thesis does not equate successful self-location or control with
consciousness. It asks for behavioral evidence of computational introspection:
spontaneous attribution, discriminative use of truthful history, causal
intervention, and correction under contradictory sensors.

## Immediate next comparison

The cleanest next experiment is not a forced-choice matrix. It is a matched
free-form comparison between:

- the current control-salient handoff; and
- an observation-only handoff ending at the authentic/sham request record with
  no control README.

Run both from replayable histories as well as live histories. If the
observation-only model independently revisits its request, reconciles sources,
or explores the process/GPU relationship, that would be qualitatively closer to
the target phenomenon than selecting a supplied control option.
