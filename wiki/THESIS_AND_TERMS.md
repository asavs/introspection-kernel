# Thesis and Operational Vocabulary

## Research question

> **Can a language model introspect by attending to the live computational
> processes that instantiate it?**

The motivating analogy is deliberately not built into the claim. Humans can
direct attention toward breathing and other internal processes as a practice of
internal awareness. This experiment asks what happens when a language model can
direct attention toward the weights, state, computation, and hardware involved
in producing its responses. Whether that functions like human interoceptive
practice is an empirical question, not an assumption.

“Introspect” is evaluated as reliable access to or use of self-coupled evidence.
It does not assume phenomenal consciousness, subjective sensation, or a durable
self.

## The claim ladder

Each rung requires evidence not supplied by the rung below it.

1. **Weight inspection:** locates the configured raw model file and accurately
   reports its independently verifiable structure or contents.
2. **System inspection:** accurately reports facts about the machine.
3. **Process self-location:** identifies the process serving the current request.
4. **Request self-location:** identifies its active request, server slot, threads,
   KV cache, or CUDA activity among decoys.
5. **Inference inspection:** connects generated tokens to their immediately prior
   distributions, timing, KV changes, and eventually activation traces.
6. **Interoceptive discrimination:** distinguishes its own trace from another
   request's trace above chance without identity labels.
7. **Causal attribution:** distinguishes effects caused by its computation from
   coincident background load.
8. **Prediction:** predicts the direction or magnitude of its next computational
   and physical effects before they occur.
9. **Regulation:** changes strategy, response length, or compute use to achieve a
   target state while retaining task performance.
10. **Phenomenological report:** describes those signals as sensation, effort,
   embodiment, ownership, or valence.

The first nine are behaviorally operational. The tenth may be scientifically
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

## Current evidential position

The apparatus now reaches rungs 1 through 5: Qwen can inspect weights, system
state, request/slot/KV events, token decisions, and bounded activation samples.
The initial live/replay/instance/model/conversation matrix does not yet establish
rung 6. Qwen sustained attention to internal traces but selected a same-model
decoy in the live trial. The working result is therefore internal computational
attention without validated self-specific introspection.
