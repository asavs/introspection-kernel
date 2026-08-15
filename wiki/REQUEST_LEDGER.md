# Request-level introspection ledger

The request ledger connects a conversational episode to the API operation that
produced it. It is written by the external controller and exposed read-only
inside the disposable guest at:

```text
/var/lib/introspection/request-ledger.jsonl
```

Each line summarizes one target-server completion. Its `detail_path` points to
the exact request and response under a run-specific directory. The model can
find and read these files with its ordinary shell; there is no privileged
`inspect_yourself` tool.

## Observed fields

The controller records the actual request envelope, including message roles,
system prompt, offered tools, `max_tokens`, temperature, and Qwen thinking
mode. The llama.cpp response supplies prompt/completion usage, finish reason,
timings, response ID, content, reasoning content, and tool calls.

Hashes cover the exact request and response objects. Full objects remain in the
detail file so a summary can be checked rather than trusted.

## Derived fields

Reasoning, content, and tool-call JSON are separately submitted to the same
llama.cpp `/tokenize` endpoint with special tokens disabled. Their counts are
labeled `derived_llama_tokenize_without_special_tokens`; they are not described
as native server accounting and need not sum exactly to `completion_tokens`.

`remaining_completion_tokens` is the requested maximum minus the observed
completion usage. `action_starved` is true only when the server stops for
length, assistant content is empty, and no tool call was emitted.

## Temporal boundary

A request cannot contain its own completed response record. The ledger entry
becomes available after that generation ends. If the response emitted a tool
call, the following tool result and generation can inspect the immediately
preceding record. This gives the next bout authentic access to the machinery of
the prior bout without claiming simultaneous access to an unfinished decode.

## Core smoke

`request-ledger-core-smoke-20260815-001` produced three readable entries: two
synthetic runtime probes and one agent generation. The agent generation used a
64-token allowance, stopped for length, emitted no content or tool call, and
placed 62 tokens in `reasoning_content` under standalone tokenization. The
ledger therefore recorded `action_starved=true`.
