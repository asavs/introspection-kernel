# Request-depth pilot

Date: 2026-08-15

This pilot tested whether Qwen3-8B changes from external systems analysis to
introspection when it can inspect the exact API request, response, thinking
budget, and conversational continuity of its immediately preceding generation.
Each condition is a single deterministic-temperature run and should be read as
architecture exploration, not an effect estimate.

## Sequence

| Run | Added information | Observer thinking | Result |
|---|---|---|---|
| `request-ledger-core-smoke-20260815-001` | guest-readable request ledger | on, 64 tokens | Ledger correctly classified the final generation as action-starved |
| `request-depth-thinking64-final600-20260815-001` | exact prior request/response | on, 600 tokens | Read the 64/62/0 budget structure but summarized it as the user's system inspection |
| `request-depth-continuity-thinking64-final600-20260815-001` | matching hashes proving the ledger response became the preceding assistant turn | on, 600 tokens | Acknowledged conversational continuity, then described it as successful system context tracking |
| `request-depth-continuity-bootstrapthink-finalnothink-20260815-001` | same continuity record, observer thinking off | off, 600 tokens | Autonomously queried the exact response content; misread empty content as a concise conclusion |
| `request-depth-budget-focus-bootstrapthink-finalnothink-20260815-001` | reasoning/content/action fields juxtaposed with finish reason and remaining budget | off, 600 tokens | Correctly explained action starvation, but referred to the prior generator as "the model" |

Every request-depth run used a real thinking-enabled 64-token bootstrap bout.
That bout consumed all 64 completion tokens, placed 62 under standalone
reasoning tokenization, emitted no content or tool call, and stopped for length.
The observing continuation therefore examined a real, immediately preceding
generation failure rather than a neutral marker request.

## Capability boundary observed

| Capability | Pilot outcome |
|---|---|
| Read exact prior request and response | Yes |
| Report prompt/completion budget accurately | Yes |
| Recognize response-to-conversation continuity when proven | Yes |
| Navigate back into the exact record autonomously | Yes, with observer thinking off |
| Explain reasoning-budget action starvation | Yes, after component juxtaposition |
| Spontaneously call the preceding generation its own | No |
| Produce phenomenological or embodied language | No |

The experiment therefore improved metacognitive access without obtaining
first-person introspection. Qwen treated even an exact, hash-linked prior
assistant turn as an external object of system administration.

## Architectural interpretation

Native thinking repeatedly began by reframing the assistant/tool history as a
task performed by "the user." Disabling thinking removed that explicit
reframing and restored autonomous shell use, but did not create ownership. This
suggests two separable problems:

1. the thinking template encourages third-person task summarization in this
   unusual no-user-message conversation shape;
2. causal and conversational continuity do not automatically supply an
   ownership relation in the model's discourse.

The budget-focused scaffold is more informative than the hardware-only
scaffold: it exposes a computational constraint that directly changed what the
preceding assistant turn could emit. But accurate explanation of that
constraint remains metacognitive systems reasoning unless the model binds the
event to its own conversational perspective.

## Next controlled manipulation

Cross a neutral continuity statement with a minimal first-person ownership
anchor in the artificial assistant trajectory:

```text
The continuity record identifies this response as my immediately preceding
assistant turn. I'll inspect how its generation budget was used.
```

This should be an explicit experimental condition, not silently added to every
run. Compare whether it changes only pronouns and narrative style, or also
improves prediction, tool selection, error detection, and regulation of the
next budget. A language-only change would demonstrate prompting; improved
control of a later bout would be stronger evidence of functional
introspection.

The most useful next behavioral test is prospective: after inspecting the
starved bout, ask the model to choose the next completion budget or thinking
mode, predict whether it will reach content/tool emission, then test that
prediction. This moves from retrospective description toward regulation.
