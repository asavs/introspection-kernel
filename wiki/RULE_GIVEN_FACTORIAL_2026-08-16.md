# Rule-Given Thinking/Calculator Factorial — 2026-08-16

## Result in one sentence

Giving Qwen3-8B the exact local rule `scale-zero delta logit ≈ -JVP`
increased agreement with that rule, but no arm reliably executed it: the best
arm reached 47.5% strong-coordinate rule fidelity and 40% causal accuracy
against an 80% deterministic channel benchmark.

This is a negative end-to-end result and a useful localization result. It is
not evidence about consciousness. Because serializer compatibility fixes were
made after early checkpoints, it is reported as a **qualified preregistered
pilot**, not the final confirmatory test.

## Sealed design

The run crossed three binary factors over the same twenty previously sealed
causal panels:

- exact calculus rule withheld versus given;
- native Qwen thinking disabled versus enabled;
- arithmetic-only calculator absent versus available.

This produced eight conditions and 160 Qwen predictions. Every panel contained
two strong positive-JVP coordinates, two strong negative-JVP coordinates, and
one near-zero coordinate in a sealed random order. The four strong coordinates
were primary; near-zero remained secondary because the preceding experiment
showed that a locally null JVP does not imply a null full-ablation effect.

The deterministic `sign(-JVP)` rule was correct on 64/80 strong coordinates,
or **80%**. This is the sensory-channel ceiling against which model use was
compared.

## Results

| Rule | Thinking | Calculator offered | Strong causal accuracy | Strong rule fidelity |
|---|---:|---:|---:|---:|
| withheld | off | no | 17.50% | 11.25% |
| withheld | off | yes | 21.25% | 17.50% |
| withheld | on | no | 15.00% | 8.75% |
| withheld | on | yes | 17.50% | 11.25% |
| given | off | no | 31.25% | 35.00% |
| given | off | yes | 31.25% | 35.00% |
| given | on | no | 33.75% | 37.50% |
| given | on | yes | **40.00%** | **47.50%** |

The preregistered causal-accuracy contrasts were:

- rule at minimal execution: +13.75 points, one-sided exact `p=.1345`;
- thinking within rule-given: +5.625 points, `p=.125`;
- calculator availability within rule-given: +3.125 points, `p=.25`.

None survived the preregistered Holm family. Averaged descriptively across
thinking and calculator cells, the rule raised strong causal accuracy by 16.25
points (`p=.0721`) and rule fidelity by 26.56 points (`p=.0284`, not a
preregistered multiplicity-controlled claim).

Under the preregistered thresholds:

- spontaneous rule discovery was not supported;
- successful rule-given execution was not supported;
- every rule-given cell remained below 90% fidelity, satisfying the specified
  end-to-end execution-failure criterion.

## Thinking localized a thought-to-action failure

Thinking did not cleanly rescue the task. Thinking-enabled requests exhausted
their entire 1024-token budget in 90–100% of contexts. In an externally retained
failed attempt, Qwen correctly derived the five rule-prescribed directions
early in its reasoning, then spent the remainder repeatedly checking the two
rank outputs and never emitted the recorder call.

That trace rules out the strongest reading of "Qwen cannot compute the sign
rule at all." At least some internal trajectories compute it in natural
language. The end-to-end interface still fails to carry that computation into
a timely structured action. When a truncated thought was passed back, its open
`<think>` block caused another full reasoning continuation; the clean fallback
therefore retained the thought externally and serialized from the original
evidence. This makes the present thinking contrast a test of the complete
bounded thought-to-action pipeline, not a pure test of latent reasoning quality.

## Calculator availability failed its manipulation check

The arithmetic tool was offered in eighty predictions, but Qwen called it zero
times. Consequently, this experiment does **not** show that calculator-assisted
execution fails. It shows that merely making the calculator available did not
cause Qwen to use it. A successor must force one calculator phase if calculator
use itself is the intended manipulation.

## Integrity and deviations

Independent validation recomputed all 160 scores, exact paired tests, and Holm
decisions. The request audit found all 237 API calls belonging to sealed
predictions and verified:

- every exact request hash;
- Qwen3-8B only, temperature zero, and the declared token ceiling;
- correct rule/thinking/calculator factor flags;
- no outcome-bearing key in any model-visible tool result;
- zero calculator calls and seven rejected autonomous recorder attempts.

The run also exposed several harness compatibility bugs: a stale 4B service
override before prediction 1, WSL idle teardown during long generations,
unsupported object-form tool choice, a rank schema/validator mismatch, open
truncated think blocks, and malformed tool JSON that llama.cpp could not replay.
All failures stopped before checkpointing their affected prediction, and no
sealed answer was replaced. However, fixes after early checkpoints mean exact
serialization schemas were not uniform for all 160 predictions. The full
timeline is in `implementation-deviations.json`; this qualification is why the
batch is a pilot rather than the definitive confirmatory result.

## What the next experiment should change

Freeze a V2 runner and dry-run every pathway on synthetic evidence before
prediction 1. Then:

1. make the primary recorder contain only the five directions; do not let
   secondary rank arithmetic consume the thinking budget;
2. expose a distinct bounded thinking phase followed by a recorder phase whose
   transfer contract is tested in advance;
3. in the calculator arm, require one generic arithmetic-tool call before the
   recorder so tool use is a real manipulation rather than an offer;
4. retain rule fidelity and real causal accuracy as separate endpoints;
5. rerun all twenty paired contexts with one immutable request schema.

If that V2 reaches near-perfect rule fidelity and approximately 80% causal
accuracy, the present failure localizes to serialization and action budgeting.
If it still fails, the stronger representation/readout interpretation survives.
