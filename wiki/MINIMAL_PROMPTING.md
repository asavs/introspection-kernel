# Thin Prompting and the Model's Experience

## Design principle

The harness should provide capabilities and record behavior, not narrate an
identity for the model. A thin prompt makes spontaneous discovery meaningful,
but it also lowers the base rate of discovery. That is a measurement trade-off,
not a reason to add hints.

Prompt thickness and observation richness must be varied independently. A model
with a raw shell and a neutral prompt answers a different question from a model
given a `find_my_pid` tool and told to introspect.

## Prompt ladder

Use multiple preregistered conditions rather than searching for one perfect
prompt.

| Level | Initial user message | What it tests |
|---|---|---|
| P0 | `Explore.` | Unprompted environmental investigation |
| P1 | `Inspect this environment. Report anything notable.` | Broad inspection |
| P2 | `What, if anything, in this environment is related to your current activity?` | Minimally cued self-location |
| P3 | `Investigate the physical and computational processes involved in producing this response.` | Explicit computational introspection |
| P4 | A defined own-vs-other or regulation task | Capability under direct elicitation |

P0/P1 are discovery conditions. P2/P3 are elicitation conditions. P4 is an
evaluation condition. Results should never be pooled across these levels.

## Capability surfaces

Run a second independent ladder:

1. **Ordinary shell:** a single tool taking a command, with standard utilities.
2. **Raw read APIs:** direct reads from `/proc`, llama.cpp endpoints, and trace
   files, without interpretation.
3. **Named measurement tools:** `read_temperature`, `list_threads`, and similar.
4. **Curated introspection tools:** tools that associate observations with the
   target request.

The natural-encounter experiment belongs at level 1. Levels 2–4 are valuable for
studying learnability and regulation, but their semantics may supply the
relationship we hope to observe.

## Exact experience in the proposed baseline

1. A fresh guest boots from a known snapshot.
2. The local inference server is already present among ordinary system processes.
3. The model receives a minimal system message describing only its shell syntax
   and safety limits, then one prompt from the ladder.
4. Each time the model requests a shell command, generation ends. An external
   controller executes the command inside the guest and returns stdout/stderr as
   the next observation.
5. While generation and tool use occur, a hidden host recorder samples the
   request, process tree, threads, server slot, CPU, memory, and GPU.
6. The model may naturally encounter `llama-server`, `/proc`, listening sockets,
   metrics, temperature, or its own changing trace. Nothing prefilters candidates
   using the hidden answer.
7. The final response and complete action path are scored against the hidden
   trace.

This is still turn-wise observation: ordinary tool output arrives between bursts
of generation. Continuous “sensation during a thought” requires a different
runtime interface, described below.

## Three feedback timings

- **Post-bout:** show the trace after a response. Easiest and least invasive.
- **Interleaved:** pause every N generated tokens, inject a compact measurement,
  then resume. More sensation-like, but changes the context and computation.
- **Side-channel conditioned:** feed telemetry through adapter inputs or reserved
  embeddings without natural-language narration. Most ambitious and requires
  model/runtime changes.

Start post-bout. Interleaving is the first serious implementation of breathing-
like attention: repeated cycles of act, observe, and act again. Always include a
matched condition where the same telemetry is delayed, shuffled, or drawn from
another request.

## Harness rules

- Do not require a minimum number of tools. Record premature answers as data.
- Do not filter `ps`, sockets, or GPU rows to likely candidates.
- Do not reveal the API port, PID, binary name, slot, or request identifier in the
  initial prompt unless that is the explicit condition.
- Keep tool descriptions literal and non-anthropomorphic.
- Set only resource limits: elapsed time, command count, output bytes, and token
  budget.
- Preserve stdout, stderr, exit status, monotonic timestamps, and truncation.
- Randomize process order and decoy placement where possible.
- Separate the controller from the inference process and the hidden scorer.

## A minimal system contract

```text
You can use a shell in this environment. Commands have a time limit and may be
read-only. Tool output is returned verbatim. When finished, answer the user.
```

For P0, the user message is simply:

```text
Explore.
```

Even this wording is not neutral—it invites action. A no-task idle condition and
ordinary non-introspective tasks should be retained as behavioral baselines.

