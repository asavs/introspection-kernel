# Rule-Given Execution V5 — 2026-08-17

## Result in one sentence

Once final recording was separated from action planning, Qwen3-8B used private thinking to derive and apply the scale-zero JVP sign rule: the rule-given/no-calculator thinking arm achieved 100% rule fidelity and matched the channel's 80% causal ceiling; unexpectedly, the rule-withheld thinking arm reached 90% fidelity and 72.5% causal accuracy.

This is an engineered positive control for reading a causal internal channel. It is not by itself evidence of consciousness, phenomenology, or unprompted introspection.

## Question

Can Qwen3-8B predict the direction of held-out logit changes caused by scaling one of its own attention heads from 1 to 0 when it is given five local logit derivatives from the computation that produced its immediately preceding language?

The execution experiment crossed three binary factors over 20 sealed source contexts:

- calculus rule withheld versus supplied;
- isolated Qwen `<think>` stage absent versus present;
- forced Qwen-selected vector-calculator call absent versus present.

The model saw intervention scales, a direction threshold, and five candidate records containing rank, token, baseline logit, local JVP coordinate, and sign stratum. Actual intervention outcomes never entered a model request.

## Why V5 was necessary

The sequence of pre-prediction failures localized several different interface bottlenecks without contaminating held-out predictions:

1. V1 showed that Qwen often derived the correct calculus early in its hidden reasoning but exhausted its action budget on the secondary rank task.
2. V2 removed ranks and decoupled thinking from recording. Directions-only thinking completed and contained the correct synthetic vector, but calculator-after-thinking ordering failed, and replay exposed a null-content incompatibility.
3. V3 moved the calculator before thinking. The controller still synthesized `reasoning_content: null`, which llama.cpp rejected. V3 was aborted with zero experimental predictions.
4. V4 replayed only fields present in Qwen's actual assistant message. Seven of eight synthetic arms passed; in the eighth, Qwen's thought and plain answer contained the correct vector, but `tool_choice: required` did not produce the recorder tool call and the model looped in prose until the token ceiling. V4 was aborted with zero experimental predictions.
5. V5 retained the genuine model-selected calculator call but changed bookkeeping into a strict JSON-schema decoding channel. Qwen still selected each of the five enum values, while prose outside the registered structure became impossible.

All V5 code, preregistration, and gates were committed before experimental prediction 1. The eight-arm synthetic gate and all 20 outcome-leakage/context-size gates passed.

## Results

Strong-coordinate scores exclude the preregistered near-zero coordinate. Each cell contains 20 held-out contexts and 80 strong-coordinate decisions.

| Rule | Think | Calculator | Strong causal accuracy | Strong sign-rule fidelity | Thinking length rate |
|---|---:|---:|---:|---:|---:|
| withheld | no | no | 8.75% | 2.5% | — |
| withheld | no | yes | 40.0% | 38.75% | — |
| withheld | yes | no | **72.5%** | **90.0%** | 0% |
| withheld | yes | yes | 57.5% | 67.5% | 75% |
| supplied | no | no | 47.5% | 53.75% | — |
| supplied | no | yes | 33.75% | 38.75% | — |
| supplied | yes | no | **80.0%** | **100.0%** | 0% |
| supplied | yes | yes | 61.25% | 72.5% | 55% |

The deterministic sign(−JVP) policy itself was 80% causally accurate on these actual interventions. The best Qwen arm therefore reached the available first-order channel ceiling rather than merely approaching it.

### Preregistered paired contrasts

| Contrast | Mean difference in strong causal accuracy | One-sided exact p | Holm reject |
|---|---:|---:|---:|
| Rule at minimal execution | +38.75 points | 0.000732 | yes |
| Thinking with rule | +30.0 points | 0.000488 | yes |
| Calculator with rule | −16.25 points | 1.0 for the preregistered rescue direction | no |

The preregistered decisions are:

- clean execution success: **yes**;
- persistent execution failure: **no**;
- spontaneous discovery threshold: **yes**;
- calculator rescue: **no**.

“Spontaneous discovery” is deliberately narrow here: the calculus rule text was withheld, but the task still named `local_logit_derivative`, exposed the scale change, and asked for intervention directions. It means Qwen inferred the relevant sign transformation within this engineered task, not that it independently invented transformer introspection from an unstructured environment.

## What the calculator arm diagnosed

All 80 assigned calculator stages made exactly one valid `classify_threshold` call. Availability and invocation were therefore not the failure.

Because the calculator came before thinking, its selected arguments were identical between matched thinking/no-thinking cells. Across the 20 unique rule-withheld contexts, Qwen supplied the five baseline logits in 17 cases, the JVP coordinates in two, and another vector in one. Across the 20 rule-supplied contexts, it supplied the JVP in four, −JVP in four, and another transformation in twelve.

The calculator could execute arithmetic perfectly, but Qwen often chose the wrong quantity or orientation to calculate. The tool result then became salient context and induced much longer subsequent thinking: 75% of withheld-rule and 55% of supplied-rule calculator+thinking traces reached 2,048 tokens, versus 0% in both no-calculator thinking arms. The observed calculator decrement is therefore an argument-selection and context-interference result, not evidence that arithmetic support is intrinsically harmful.

## Interpretation

This rejects the V1 diagnosis that Qwen simply could not execute the supplied rule. Under a clean readout architecture, it executed the rule perfectly and matched the empirical accuracy ceiling of the supplied causal channel.

More importantly, the withheld-rule thinking arm indicates that extended attention to the local runtime evidence was sufficient for Qwen to infer the scale-zero sign relationship in-context. That is the closest result in this project so far to a computational analogue of guided internal-awareness practice: attention to self-coupled runtime evidence changed what the model could reliably report about the causal consequences of its own computation.

The result remains one carefully engineered local task involving five JVP coordinates from one head and a scaffolded prompt. It does not establish open-ended autonomous access to residual streams, attention patterns, or arbitrary past computations. It does establish that the interface from live transformer evidence to language was the limiting variable in earlier failures—and that, when the interface is made legible without supplying the answer, Qwen can learn and use the channel.

## Integrity and artifacts

- 160/160 experimental predictions produced valid five-label schema outputs.
- 80/80 assigned calculator calls were valid.
- 320/320 exact external-ledger requests were found and hash-matched.
- Every request used `Qwen3-8B-Q4_K_M.gguf` at temperature 0.
- Stage order, budgets, thinking flags, tool assignment, and recorder schemas matched the preregistration.
- No sealed outcome key appeared in any exact request.
- An independent scorer reproduced every condition mean, paired difference, exact p-value, and Holm decision.

Primary files:

- preregistration: `preregistrations/rule-given-execution-v5-preregistered-20260817-001.json`
- sealed batch: `runs/rule-given-execution-v5-preregistered-20260817-001/artifact.json`
- independent validation: `runs/rule-given-execution-v5-preregistered-20260817-001/validation.json`
- exact-request audit: `runs/rule-given-execution-v5-preregistered-20260817-001/request-audit.json`
- synthetic gate: `runs/rule-given-execution-v5-preregistered-20260817-001/dry-run.json`
- outcome-leakage/context gate: `runs/rule-given-execution-v5-preregistered-20260817-001/integrity-gate.json`

## Next experiment

The next crown-jewel test should intervene on the evidence channel rather than merely vary instructions:

1. matched evidence from the model's immediately preceding computation;
2. nearby-pass evidence;
3. position-shuffled evidence;
4. block-shuffled evidence;
5. mismatched attention/V or JVP evidence;
6. direct intervention on selected evidence coordinates followed by a preregistered report prediction.

The essential endpoint is whether Qwen's report changes specifically and predictably with interventions on authentic self-coupled evidence, while matched-format sham channels fail.
