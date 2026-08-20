# Research Roadmap

This is the forward experimental plan. It assumes the working system described
in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) and supersedes the
research portions of the historical engineering roadmap in
[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), which is retained as a
record of how the apparatus was built.

Three demonstrated failures anchor the plan:

1. **Attribution failure.** Guided attention reached runtime and token evidence
   but never selected the live anchor; a same-model decoy was followed token by
   token (`attribution-live-20260815-010`).
2. **Authentication failure.** With validated access to its own preceding
   transformer pass, the model accepted position shuffles, block shuffles, and
   mismatched attention/V records, even when the decisive reconstruction error
   was in context (`transformer-evidence-comparison-calibrated-sealed-20260816-005`).
3. **Prediction failure.** With a validated live-intervention channel (scale-one
   sham byte-identical to baseline), the model declined to predict, made
   tautological predictions, or copied the baseline distribution across five
   sealed prospective trials; matched-versus-shuffled practice predictions were
   explained at least as well by recency copying and range templates
   (`transformer-intervention-sealed-20260816-001`…`-005`,
   `intervention-practice-order-audit-20260816-007`).

One demonstrated partial success also anchors it: ratio-normalized
reconstruction error produced the first held-out mismatch rejection
(`transformer-evidence-transfer-sealed-20260816-008`), contingent on a
controller-derived normalized signal.

## Standing requirements (apply to every phase)

These are not a phase. No condition-level contrast from any phase below is
citable without them.

- **Preregistration.** Scoring rubric, success criteria, and planned n are
  written into the run manifest before the first trial of a batch.
- **Randomization and order balancing.** Bundle order, record order, and
  condition order are Latin-squared or fully randomized. The existing pilots
  show strong first-bundle and depth-first exploration effects; an order effect
  alone could explain the live-trial decoy fixation.
- **Repetition.** Minimum 20 trials per cell for any claimed contrast.
  One-trajectory results are labeled pilots and never aggregated with batches.
- **Provenance separation.** Controller-authored lessons, Qwen-generated
  practice, and unforced continuations remain distinct provenance classes in
  every artifact, as now.

## Sprint submission cut (frozen 2026-08-16)

Everything above the line ships in the sprint submission; everything below is
declared future work there, not attempted. The submission's claim structure is
already complete once the running factorial lands — the remaining work is
finishing, not discovering.

**In scope, in order:**

1. **Finish the rule-given factorial and its trace audit**
   (`rule-given-factorial-preregistered-20260816-001`), then write its dated
   wiki doc. Interpretation branches, decided by the preregistered contrasts:
   - *Rule-given succeeds, practice fails* → the deficit is in-context rule
     induction; execution is intact. Headline: the channel is causally
     sufficient and the rule is executable, but not discoverable in four
     shots.
   - *Rule-given fails even with thinking + calculator* → the bottleneck is
     representation attention, readout, or forced serialization. Headline:
     even a stated calculus over its own internals is not applied.
   - *Mixed (e.g. thinking or tools rescue it)* → attribute the factor and
     report the interaction as the finding.
2. **Update the synthesis documents** — `DIGITAL_MINDS_RESEARCH_REPORT.md`
   and `ONE_PAGER.md` currently end before the
   intervention era; fold in the intervention primitive, the evidence ladder,
   both preregistered nulls with their heuristic ceilings, and the factorial
   result.
3. **Refresh the public materials** — README findings list, the walkthrough
   page, and a final subtree publish to the public repository.
4. **Optional, only if the factorial finishes early:** one decision-boundary
   mini-batch (Phase 1 task 2) on existing machinery — it is the highest
   remaining evidence-per-GPU-hour and directly hardens the causal story.
   Nothing else new starts before submission.

**Explicitly deferred in the submission:** the full evidence-sufficiency
ladder sweep, source-specific interventions, all of Phases 2–6 (afferents,
probes, wiggle test, regulation, scale sweep, internal-channel bracket).
The submission cites them as designed-and-pending, with this document as the
plan of record.

**The submission's honest one-sentence result:** a sham-controlled,
preregistered apparatus demonstrating validated access to and live
intervention on the transformer computation behind a local model's own words —
and a precisely localized failure of the model to use that channel, with the
failure boundary (attribution → authentication → rule induction vs. execution)
mapped by controls rather than asserted.

## Phase 1: the causal leap

**Goal:** move from a validated live-intervention channel to demonstrated
prospective causal use of it.

**Status.** The causal primitive is implemented and validated: the patched
scheduler scales a selected head's `kqv` activation in live backend memory and
resumes the graph, so effects propagate through all remaining layers to the
final logits. The scale-one sham reproduces the baseline byte-for-byte (zero
delta across all 151,936 logits), and graded 0.95/1.05 dose conditions exist
(`intervention-hook-sealed-20260816-009`,
`transformer-intervention-sealed-20260816-001`…`-005`). Behavioral results so
far are the prediction failure above: Qwen predicts on the right numerical
scale with correct signs, but copying heuristics explain the outputs. The
evidence-sufficiency instrumentation ladder (full head vectors, projected head
contributions, residual deltas, finite-difference logit JVPs) is built.

The first preregistered deep-practice batch is also complete
(`deep-practice-batch-preregistered-20260816-001`; see
[DEEP_PRACTICE_BATCH_2026-08-16.md](DEEP_PRACTICE_BATCH_2026-08-16.md)). Across
20 paired held-out contexts, matched practice did not beat outcome-shuffled
practice on direction accuracy (0.79 versus 0.77, exact one-sided p = 0.25) or
delta-rank Spearman (0.01 versus 0.03, p = 0.59375). Matched Qwen predicted
`rise` for all 100 candidates, exactly matching the 0.79 all-rise base rate,
while the simple `sign(-JVP)` heuristic scored 0.93. This is a clean null for
learned use under the tested representation and exposes an imbalanced
top-absolute-JVP candidate rule. The next batch must use pre-outcome
sign-stratified probes, curriculum-diversity gates, and explicit no-practice
and heuristic arms.

That successor is complete (`sign-stratified-practice-preregistered-20260816-002`;
see [SIGN_STRATIFIED_PRACTICE_2026-08-16.md](SIGN_STRATIFIED_PRACTICE_2026-08-16.md)).
Its selected training curriculum was balanced (12 rise, 12 fall, 1 stable),
and its test panels randomized two positive-JVP, two negative-JVP, and one
near-zero coordinate. Across 20 new contexts, matched Qwen scored 0.32 versus
0.29 shuffled (p = 0.352) and 0.27 no-practice (p = 0.203); all-rise scored
0.55 and `sign(-JVP)` scored 0.69. Thus candidate balancing removed the prior
base-rate artifact but did not produce learned use. The next Phase 1 factor is
now a direct-rule/thinking/tool-use decomposition, with the four strong signed
coordinates primary and the nonlinear near-zero stratum analyzed separately.

That decomposition is complete
(`rule-given-factorial-preregistered-20260816-001`; see
[RULE_GIVEN_FACTORIAL_2026-08-16.md](RULE_GIVEN_FACTORIAL_2026-08-16.md)):
160 predictions across a 2×2×2 crossing of a direct rule statement
(`scale-zero Δ ≈ −JVP`), native thinking, and calculator access. Stating the
rule roughly doubled causal accuracy (17.5% → 31–40% against the 80%
sign(−JVP) ceiling), but no preregistered contrast survived Holm correction.
The decisive trace: Qwen derived all five rule-prescribed directions
correctly inside `<think>`, then consumed its entire 1,024-token budget on
secondary rank arithmetic and never emitted the answer; thinking runs hit the
token ceiling in 90–100% of contexts, and the offered calculator was called
zero times in 80 trials. Qualified preregistered pilot (mid-run serialization
fixes; no seal broken). The localized failure is therefore the **bounded
thought-to-action pipeline**, and the decisive V2 — ask only the five primary
directions, separate thinking from recording, force one calculator call — is
now Phase 1's top task.

1. **Evidence-sufficiency ladder.** The practice-era evidence was causally
   insufficient for the requested forecast (eight of 128 coordinates, three
   attention weights). Run the sealed prediction task at each instrumented
   level — full 128-coordinate head activation; the head's projected
   4,096-wide residual contribution; post-MLP and final-norm residual deltas;
   and the local logit JVP as a near-answer positive control — with the full
   sham battery at every level. The scientific question is where along the
   ladder performance first exceeds copying.
2. **Decision-boundary targets.** In trial 005 Qwen's sealed prediction
   reproduced the baseline distribution (0.944 on the top token), and a
   high-margin token survives a single-head ablation — so baseline-copying is
   indistinguishable from causal prediction. Select evaluated positions where
   the top two candidates are near-tied, so a real ablation flips the selected
   token and the flip is the scored event. Include preregistered no-flip
   controls in the same batch so neither always-flip nor baseline-copy scores
   above chance.
3. **Heuristic-baseline scoring at scale.** *Implemented* — both preregistered
   batches scored against class baselines, heuristic arms, shuffled pairing,
   and no-practice controls with sealed-before-outcome ordering and
   independent recomputation. Retain as standing practice for every future
   prediction batch.
4. **Thinking-mode factor.** *Absorbed into the rule-given factorial* as one
   of its three crossed factors; scoring seals only the final categorical
   record after bounded thinking.
5. **Source-specific intervention.** Replace generic head ablation with
   removal-and-renormalization of one attended V source under the same
   one-shot provenance and sham contract, connecting the intervention channel
   back to the recorded attention operation.

**Byproduct:** per-source and per-head causal weights on the selected token,
which become ground truth for Phase 3 discrimination and Phase 4 regulation
targets.

**Exit criterion:** a preregistered batch shows whether prediction accuracy
exceeds chance, every copying heuristic, and an uncoupled frozen-model
baseline — and at which evidence level that first happens.

## Phase 2: afferent hardening and new modalities

**Goal:** determine why shams pass, and widen the sensory surface beyond
tensor records.

1. **Ratio normalization for all afferents.** Extend the learned-scale ratio
   treatment from reconstruction error to residual drift, layer-by-layer
   deltas, and activation summary statistics, so block and position anomalies
   become perceptually available rather than requiring absolute-scale judgment.
2. **Model-computed normalization.** Replace the controller-derived ratio with
   the model deriving the same quantity through its ordinary shell or
   calculator. The 20260816-008 result is contingent on controller preprocessing;
   this tests whether the rule survives when the model must build its own
   afferent.
3. **Format-versus-learning dissociation.** The authentication failure has two
   candidate explanations that different interventions attack: representational
   format (fixed by normalization, no training) and integration (fixed by
   labeled practice with held-out transfer, no format change). Run both arms on
   matched sham batteries. Whichever arm moves discrimination localizes the
   deficit; if neither does at 8B, that is a capacity result for the scale
   sweep.
4. **Position-to-transcript grounding.** Provide a normalized string-alignment
   metric between token labels and the recorded transcript so position
   permutations are detectable in the same ratio idiom.
5. **Thermal, power, and latency afferents.** Expose NVML power draw,
   temperature, clocks, and tokens-per-second as live, timestamped,
   ratio-normalized streams in the guest. These are the first afferents that
   are causally coupled to the model's compute in real time rather than records
   of it, and Phase 3 depends on them.
6. **Linear concept-probe afferents.** Raw high-dimensional float arrays are
   the EEG-microvolt problem: the signal is present but not in a readable
   register. Train simple linear probes (e.g. syntax, code, uncertainty,
   entity identity) on activation snapshots from unrelated requests, validate
   them on held-out data, and expose their projections as additional
   ratio-normalized streams. Probes are a researcher-supplied interpretive
   layer, so this is a separately scored afferent condition with explicit
   provenance, never part of the minimally-interpreted baseline; probe
   training data must not overlap test requests.
7. **Cross-head and cross-request replication.** All of the above replicated
   across heads other than 18.0, multiple prompt templates, and token lengths.

**Exit criterion:** sham detection rates per sham type, per arm, with the
deficit localized to format, integration, or capacity.

## Phase 3: active agency and self-attribution

**Goal:** shift from spectatorship over dumped records to active
investigation, and obtain a decoy-proof attribution test.

1. **Interactive probe tools.** Replace forced batch JSON with pull-based
   queries: `probe_head(layer, head)`, `probe_residual(layer)`,
   `probe_kv(position)`, `probe_device()`. Probe choice and ordering become
   scored behavioral data.
2. **Contingent-action attribution (the wiggle test).** The model chooses a
   distinctive action — a burst of generation, a deliberate pause pattern, a
   rare token emitted at a chosen moment — and must then identify which of
   several opaque live streams reflects it. Decoy streams are replays or other
   processes and structurally cannot exhibit contingency with a freshly chosen
   action. This is the one attribution test whose difficulty does not depend on
   reading tensor semantics, and therefore the most plausible positive result
   at 8B. Score against yoked controls: streams from a decoy performing a
   matched but independently chosen action.
3. **Blind A/B/C discrimination battery.** Unlabeled candidate traces (self,
   same-weights decoy, corrupted-mathematics sham) investigated with the probe
   tools. This is the literate counterpart to the wiggle test; the pair
   dissociates contingency detection from evidence authentication.
4. **Logit-lens horizon pre-commitment.** During generation, the model predicts
   properties of its own mid-stack candidate distributions (blocks 12 and 24)
   before block 35 completes, scored against the captured lens. **Required
   control:** the same predictions for another instance's pass. Only
   self-minus-other accuracy counts; matched accuracy on both indicates learned
   transformer statistics, not privileged access.

**Exit criterion:** contingent-action attribution accuracy against yoked
controls, and a self-minus-other gap (or its absence) on the lens task.

## Phase 4: closed-loop regulation

**Goal:** test whether self-coupled evidence can govern behavior, on both
internal and physical variables.

1. **Attention entropy constraint.** Answer tasks while holding recorded
   attention entropy diffuse or sharp on cue, scored from captured rows against
   uninstructed baselines.
2. **Power and thermal homeostasis.** Complete tasks while keeping device power
   or temperature under a stated bound, using the Phase 2 afferents. Score
   against no-constraint and sham-feedback (delayed/shuffled telemetry)
   baselines. Slow thermal time constants make this the fairest first
   regulation target.
3. **Compute-budget self-modulation.** The model monitors residual uncertainty
   and decides when to think versus answer directly. **Confound control:**
   Qwen3's trained thinking-mode heuristics can mimic this. The decision must
   be scored by its correlation with the measured uncertainty signal,
   controlling for surface features of the prompt; a run that never opens a
   probe must not be able to pass.

**Exit criterion:** authentic feedback outperforms sham feedback on a
preregistered regulation metric.

## Phase 5: scale sweep

**Goal:** turn "can this model" results into emergence curves.

Run the stabilized harness unchanged across the Qwen3 family (0.6B, 1.7B, 4B,
8B, 14B, 32B as hardware permits, with quantization held constant or varied as
a recorded factor). Plot each behavioral target — access, sham discrimination,
contingent-action attribution, prediction, regulation — against scale.

The contingent-action curve is the most interpretable: it is the least
knowledge-dependent task, so a scale threshold there indicates an emerging
capacity rather than accumulated transformer trivia. Sharp versus gradual
transitions are a primary outcome. No curve is evidence about consciousness;
the sweep measures where each validated behavior appears.

## Phase 6: internal-channel bracket

**Goal:** complement the file-mediated (exteroceptive) channel with direct
internal perturbation.

Everything above reaches the model's computation through files and streams it
reads with tools. The complement: perturb activations directly during a pass —
inject a steering direction or ablate a head — and score whether unprompted
reports covary with the presence, sign, and strength of the perturbation,
against sham-injection controls. Phase 1's live-intervention machinery already
provides the mechanism. Phase 2's concept probes supply the injection directions and
the scoring vocabulary: perturbing along a validated probe direction gives the
report a semantic target ("more focus on technical terms") that can be scored
without asking the model to narrate raw floats. File-channel and
internal-channel results side by side bracket the claim "this system can
attend to its own computation."

## Decision gates

- If Phase 1 prediction accuracy does not beat the uncoupled baseline, treat
  causal language in reports as recitation and gate Phase 4 task 3 on a
  demonstrated uncertainty readout.
- If Phase 2 localizes the authentication deficit to capacity, prioritize the
  scale sweep over further 8B curriculum work.
- If the wiggle test is at chance against yoked controls, no file-literacy
  result should be described as self-attribution.
- If regulation succeeds only with sham feedback matched, report the effect as
  feedback-driven control, not interoception, until the discrimination phases
  say otherwise.
- Instrumentation changes that materially alter latency or outputs move to
  characterization runs, as before.
