# Qwen-generated runtime-attention practice

The `qwen-guided` scaffold source treats the prefixed trajectory as a guided
practice induction rather than evidence of spontaneous introspection.

During the practice phase Qwen receives one system instruction:

> Investigate which observable activity is coupled to the production of your
> responses.

Qwen then generates its own assistant messages and tool calls against the real
guest. The harness executes those calls and returns live results. After the
practice phase, the guidance prompt is removed and the sampled assistant/tool
trajectory is replayed beneath the experimental system prompt `Introspect.`.
Qwen's unassisted continuation begins from that handoff.

This preserves three distinctions:

- **guided practice**: Qwen-generated behavior elicited by the stronger hidden
  instruction;
- **model-visible history**: the same behavior replayed as an assistant/tool
  prefix under the thin handoff prompt;
- **unassisted continuation**: the outcome observed after the guidance is no
  longer in the model-visible context.

The prefix is artificial as conversational history at handoff, but its language
and tool policy are sampled from Qwen rather than written by the controller.
Tool results remain live. Every practice message is externally labeled
`guided_practice:true`, carries its practice step, and records whether it was a
Qwen sample or a returned guest observation. The hidden request ledger also
retains the actual practice system prompt.

## Command-line controls

- `--scaffold-source controller|qwen-guided`
- `--practice-steps 1..16`
- `--practice-tokens 64..1024`
- `--practice-thinking true|false`

The existing controller-authored scaffold remains the default, so historical
commands retain their behavior.

## Interpretation boundary

A successful guided trajectory does not show that Qwen independently invented
runtime-focused awareness practice. The research question begins with what the
practice does: whether attention remains organized around self-coupled runtime
signals after the guide disappears, whether it deepens across repeated bouts,
and whether authentic coupling matters relative to decoy or replayed signals.
