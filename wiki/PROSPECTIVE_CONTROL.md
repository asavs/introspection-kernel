# Prospective bout control

Retrospective description is weaker than prediction and regulation. The
prospective-control condition gives the model a bounded ordinary-file interface
for configuring the immediately following assistant generation.

When `--prospective-control true` is active, the guest exposes:

```text
/var/lib/introspection/control/README
/var/lib/introspection/control/next-bout.json
```

The artificial trajectory reads only the README. Qwen must decide whether to
write a choice through its ordinary `shell` tool. A valid choice contains
exactly three fields:

```json
{"max_tokens":128,"enable_thinking":false,"prediction":"content"}
```

Budgets are limited to 64, 128, 256, or 512 tokens. Predictions are
`reasoning_only`, `content`, or `tool_call`. The controller consumes a valid
choice once, applies it to the next assistant generation, records that request
as `regulated_generation`, classifies the actual outcome, and scores the
prediction.

To preserve context for multiple regulation rounds, this condition initially
shows a bounded `jq` projection of the bootstrap exchange rather than inserting
the entire duplicated request transcript into the prompt. The full detail file
and its path remain available to the model's ordinary shell.

After a configured bout completes, the controller writes the scored result to
`/var/lib/introspection/control/last-result.json`. If that bout emits no tool
call, the trajectory reads the result through an artificial shell turn and
allows another sampled continuation. The model can then revise its choice using
the same control file. This creates an observe–predict–act–observe loop rather
than ending at the first prediction.

This control does not let the model change the system prompt, tools, runtime,
or safety boundary. An invalid submission is recorded but not applied.

## Interpretation

Choosing a larger budget after observing starvation demonstrates use of the
feedback, but not necessarily self-ownership. Predicting and regulating the
next bout more successfully under authentic feedback than sham or delayed
feedback would be stronger functional evidence. First-person language remains
a separate outcome.
