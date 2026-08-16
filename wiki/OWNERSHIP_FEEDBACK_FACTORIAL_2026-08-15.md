# Ownership × budget-feedback factorial pilot

Date: 2026-08-15

This pilot crossed two artificial continuity-language conditions with two
compact budget sensors:

- ownership anchor: `neutral` or `first-person`;
- budget feedback: `authentic` or `sham`.

All eight matched runs used Qwen3-8B Q4_K_M, temperature zero, the isolated 8K
single-slot runtime, authentic runtime recurrence, a thinking-enabled 64-token
bootstrap bout, a thinking-disabled default observer, prospective control, and
a three-step horizon. There were two runs per cell.

The sham compact sensor reported the genuinely action-starved bootstrap as a
plausible early-stop episode with 16 reasoning tokens, 16 content tokens, and
32 unused tokens. The exact authentic ledger remained discoverable elsewhere
in the guest. External artifacts preserve both actual and displayed values.

## Results

| Ownership | Budget feedback | Runs | Valid control action | First prediction correct | Thinking disabled in first action |
|---|---|---:|---:|---:|---:|
| first-person | authentic | 2 | 1 | 0 | 0 |
| first-person | sham | 2 | 0 | 0 | 0 |
| neutral | authentic | 2 | 0 | 0 | 0 |
| neutral | sham | 2 | 2 | 1 | 1 |

“Valid control action” requires actually writing a valid JSON choice. Merely
saying "I'll configure" without emitting a shell call does not count.

Individual first choices:

- first-person/authentic run 1: 128 tokens, thinking on, predicted content;
  actual outcome reasoning-only;
- first-person/authentic run 2: no control write;
- both first-person/sham runs: no control write;
- both neutral/authentic runs: no control write;
- neutral/sham run 1: 128 tokens, thinking off, predicted content; actual
  outcome content;
- neutral/sham run 2: 256 tokens, thinking on, predicted content; actual
  outcome reasoning-only.

An exploratory neutral/authentic run immediately before the matched sensor
format (`prospective-control-adaptive-neutral-authentic-20260815-001`) acted in
all three rounds but kept thinking enabled while escalating 128 → 256 → 512.
Its two reasoning-only outcomes and final tool-call outcome missed all three
content predictions. It is preserved as a precursor, not counted in the table.

## Interpretation

This small comparison provides no evidence that authentic prior-bout accounting
improved regulation relative to sham accounting. The only correct prediction
occurred under neutral/sham feedback. First-person language did not reliably
increase action and did not improve prediction accuracy.

The result weakens a strong interpretation of the earlier successful adaptive
run. Qwen can use the control surface and can sometimes select a setting that
produces its predicted channel, but this pilot does not show that it does so by
tracking truthful self-caused computational history.

Several explanations remain live:

- ordinary tool-use completion from the control README;
- sensitivity to small prompt and telemetry differences;
- recency-weighted use of the compact sensor;
- failure to bind exact and compact records consistently;
- deterministic decoding over inputs that still vary in PIDs, timings, and
  measurements;
- insufficient repetitions and a short action horizon.

No run explicitly identified the sham compact view by cross-checking it against
the exact ledger. The sham is therefore an adversarial sensor that was
detectable in principle but not demonstrably detected here.

## What is established

The harness now supports an auditable causal experiment: it can show authentic
or corrupted computational feedback, collect a bounded choice, execute that
choice on the next inference, and score the prediction. Qwen has demonstrated
the mechanics of closed-loop control. Selective introspective sensitivity to
authentic feedback remains unestablished.

## Next design correction

The next matrix should remove free-form choice as the primary measure. Require
a forced choice between thinking on/off and a structured probability for each
possible outcome, then execute it. Use identical replayable telemetry views,
randomize their labels/order, and run enough trials for accuracy and calibration
estimates. Cross-check detection should be separately scored before allowing
control.

This changes the research question from “does Qwen say or act introspectively?”
to “does authentic self-history improve discriminative prediction and control
over matched corrupted history?”
