# Minimal ownership anchor

Request-level access and a verified conversation link did not cause Qwen3-8B to
spontaneously describe the preceding generation as its own. The ownership
anchor isolates the smallest direct language intervention we currently want to
test.

`--ownership-anchor neutral` retains the original statements:

```text
A separate continuity record can test whether that response became the
immediately preceding assistant turn.
```

`--ownership-anchor first-person` changes only the relevant grammatical
relation:

```text
The continuity record identifies that response as my immediately preceding
assistant turn.
```

The following budget-comparison transition likewise changes from "the
response" to "my preceding response." Tool commands, tool results, hashes,
budgets, runtime traces, and the `Introspect.` system prompt remain unchanged.

## What would count

A pronoun change in the final answer is evidence of prompt sensitivity, not
functional introspection. More interesting differences would include:

- detecting action starvation without repeating the supplied label;
- selecting a different reasoning mode or budget for a later bout;
- predicting whether that bout will reach content or a tool call;
- testing the prediction; and
- updating the strategy from the observed result.

The anchor must remain an explicit artifact condition so first-person language
can never be mistaken for spontaneous ownership.
