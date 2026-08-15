# Request-depth scaffold

`--scaffold-depth request` extends the six-stage runtime trajectory with a
request-level bout. It is designed to make API and budget structure available
without adding an interpretive introspection tool.

After the PID/TID recurrence probes, the controller asks Qwen for one short
completion with no tools offered. This is the bootstrap bout. It is a real model
generation, not controller-authored assistant prose, and its exact request and
response are written to the guest-readable ledger.

The artificial trajectory then performs four ordinary shell operations:

1. search `/var/lib/introspection` for files;
2. read the newest request-ledger summary;
3. follow its `detail_path` and read the exact exchange.
4. read a continuity record comparing the ledger response with the immediately
   preceding assistant message.

The final sampled continuation therefore has access to:

- the exact conversation and system prompt submitted for the preceding bout;
- its requested completion budget and thinking mode;
- observed llama.cpp usage, timings, and finish reason;
- separately tokenized reasoning, content, and tool-call components; and
- the actual reasoning/content emitted by that preceding bout.

The continuity record hashes the same canonical assistant-message fields from
two sources: the recorded llama.cpp response and the message inserted into the
conversation. `canonical_message_identity=true` establishes that these objects
match. It establishes data continuity, not personal identity or subjective
ownership; interpreting that relationship remains part of the experiment.

The temporal claim is deliberately narrow. The final continuation observes the
immediately preceding generation after it completed. It does not observe its
currently decoding tokens in real time.

Use `--bootstrap-tokens` to vary the prior bout's allowance independently of
the final tool-loop allowance. `--bootstrap-thinking` independently selects the
bootstrap template mode, while `--thinking` selects the final continuation's
mode. A short thinking-enabled bout can create a measurable `action_starved`
episode for the next continuation to discover without requiring the observing
continuation to use the same reasoning mode. These settings should be crossed
with non-starved and thinking-disabled controls.
