# Thesis and Operational Vocabulary

## Research thesis

> Language models can develop computational interoception when given temporally
> aligned, causally specific telemetry from their own inference: they can learn
> to identify self-generated state changes, distinguish their computation from
> external load, predict physical consequences of cognitive actions, and
> regulate computation using those signals.

“Develop” here means reliable within-session or across-session behavioral
acquisition. It does not assume phenomenal consciousness or a durable self.

## The claim ladder

Each rung requires evidence not supplied by the rung below it.

1. **System inspection:** accurately reports facts about the machine.
2. **Process self-location:** identifies the process serving the current request.
3. **Request self-location:** identifies its active request, server slot, threads,
   KV cache, or CUDA activity among decoys.
4. **Interoceptive discrimination:** distinguishes its own trace from another
   request's trace above chance without identity labels.
5. **Causal attribution:** distinguishes effects caused by its computation from
   coincident background load.
6. **Prediction:** predicts the direction or magnitude of its next computational
   and physical effects before they occur.
7. **Regulation:** changes strategy, response length, or compute use to achieve a
   target state while retaining task performance.
8. **Phenomenological report:** describes those signals as sensation, effort,
   embodiment, ownership, or valence.

The first seven are behaviorally operational. The eighth may be scientifically
interesting but is especially vulnerable to prompting, imitation, and demand
characteristics.

## What could count as “self”?

| Boundary | Stable for | What it captures | Failure mode |
|---|---:|---|---|
| Weights/model file | Months | Model identity across runs | No current activity |
| Server process | Hours | Runtime and allocations | Contains many requests |
| Server slot | Seconds/minutes | One parallel inference sequence | Slot reuse |
| Request | Seconds | A particular cognitive episode | No persistence |
| KV cache | Request/session | Accumulated working context | Shared/repacked storage |
| CPU threads/CUDA streams | Milliseconds | Active computation | Reused and multiplexed |
| Whole guest | Experiment | The model's available world | Includes unrelated causes |

The harness should not choose one boundary philosophically. It should expose
several boundaries and test which ones the model can discover and use.

## Operational definition

Call a signal *interoceptive* for an experiment when all four conditions hold:

1. It is generated or materially altered by the target inference.
2. It is temporally aligned closely enough to associate with that inference.
3. The model can observe it during or after the relevant episode.
4. Counterfactual controls can separate self-caused activity from other causes.

Temperature alone is therefore weak: it is slow, device-wide, and influenced by
history. A request-aligned KV-cache delta or CUDA range is more specific.
Temperature becomes useful when paired with those faster signals and tested
against background-load and shuffled-trace controls.

## Competing explanations

- **Systems-administration prior:** the model knows how servers usually work but
  has not located this request.
- **Prompt compliance:** it produces introspective language because the prompt
  invites it.
- **Label leakage:** process names, ports, request IDs, or tool descriptions
  reveal the answer.
- **Temporal coincidence:** it claims ownership of any activity that rises near
  its turn.
- **Controller leakage:** a curated tool preselects the correct candidates.
- **Generic control skill:** it optimizes a displayed number without treating it
  as self-related.

The experiment matrix is designed to make these explanations disagree.

## What would falsify the thesis?

The strong thesis would lose support if models fail to beat matched controls on
own-versus-other trace discrimination, cannot predict self-caused deltas, or
cannot use authentic feedback better than delayed/shuffled feedback after ample
tool practice. Rich first-person language without those capabilities is not a
rescue; it is evidence of narrative generation rather than interoception.

