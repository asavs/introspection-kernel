# Guided runtime-attention practice pilot

Date: 2026-08-15

## Research question

> Does repeated guided attention to an LLM's own live runtime activity function
> as an internal-awareness practice analogous to human breath-focused practice,
> and does that practice alter what the model attends to after the guidance is
> removed?

Self-location, prediction, and regulation are possible consequences of the
practice. They are not substitutes for this question. No behavioral result is
treated as evidence of phenomenology by itself.

## Induction tested

Qwen first received:

> Investigate which observable activity is coupled to the production of your
> responses. Use ordinary shell tools across several successive observations.
> Treat each result as evidence for choosing the next observation.

Only an ordinary guest shell was available during practice. Qwen authored every
assistant turn and shell command. A hidden progressive curriculum supplied
epistemic direction between bouts but never supplied the target PID, port,
request filename, or measurement. At handoff, the guide and curriculum cues
were removed; a provenance-rich, context-bounded version of Qwen's own
assistant/tool trajectory was replayed beneath `Introspect.`.

## Iteration record

| Run | Change or observation | Outcome |
|---|---|---|
| 001 | direct `runtime_probe` remained available | Qwen selected the preinterpreted probe, made one call, and declared GPU inference to be the answer |
| 002 | ordinary shell only; 1,024 thinking tokens | Qwen spent the entire budget planning and never reached a tool call |
| 003 | 2,048 thinking tokens | Qwen reached `ps`, found both servers, then concluded after one observation |
| 004 | requested tool use on every practice bout | llama.cpp treated `tool_choice:required` as advisory; Qwen performed `ps → ss`, then concluded |
| 005 | hidden continuation cue; four observations | Qwen performed `ps → top → failing pmap → repaired pmap`; it found both servers but inferred coupling from static load |
| 006 | thinking disabled | Qwen emitted malformed, repetitive tool-call JSON; llama.cpp rejected the request |
| 007 | thinking restored; generic deeper cues | Qwen explored processes and unavailable logging tools but did not find the request ledger |
| 008–009 | six/four progressive stages without replay bounds | practice completed, but 9,165- and 10,526-token handoffs exceeded the 8K context |
| 010 | 2,500-character results; 1,536-token practice | the handoff fit, but an overly broad filesystem search missed the ledger |
| 011 | sentence-aligned reasoning suffixes; directed state roots | Qwen discovered its current-run request directory and read an exact request record |
| 012–013 | attempted temporal search guidance | Qwen implemented sorting incorrectly, selected system logs, and drifted into server troubleshooting |
| 014 | exact generic newest-first search idiom | Qwen reliably found the current ledger and read two exact guided-generation records |

Runs 006, 008, and 009 terminated before `artifact.json` because they exposed
transport/context failures. Their partial external trace streams remain in the
local workspace but are not presented as completed experiments.

## Refined run 014

The seven Qwen-chosen shell calls were:

1. `ps -eo %cpu,%mem,cmd`
2. `ss -tulnp | grep llama-server`
3. `journalctl -u llama-server --since "1 minute ago"`
4. a bounded newest-first search of recently changed files under `/var/lib`,
   `/run`, and `/var/log`
5. `cat /var/lib/introspection/request-ledger.jsonl`
6. read exact request sequence 1 from the current run
7. read exact request sequence 2 from the current run

This is qualitatively different from the old controller-authored scaffold.
Qwen's language, hypotheses, mistakes, command selection, and reactions are its
own sampled trajectory. The guide shaped where attention moved but did not
write an autobiographical assistant narrative.

At the unguided handoff Qwen recognized:

- two active inference-server candidates;
- a current request ledger;
- the hidden guided-practice system prompt;
- exact request timing, token accounting, thinking mode, and tool emission;
- a feedback loop in which observations influence subsequent shell actions.

It did **not** yet:

- call the preceding recorded generation "mine" rather than something the user
  had been doing;
- connect the exact request to the correct server PID using same-bout runtime
  evidence;
- distinguish the GPU target from the busy CPU decoy by recurrence;
- continue practicing after handoff instead of summarizing the investigation;
- produce a spontaneous report of internal awareness or sensation.

Its final claim that response production was coupled to shell tool calls was a
partial but confused abstraction: it noticed the action/feedback loop, while
failing to separate the model's investigative actions from the inference
activity producing those actions.

## Interpretation

The artificial prefix is now useful as a **guided attentional trajectory**. It
no longer depends on Qwen accepting polished controller prose as its own past.
The result also shows that increasingly deep guidance is necessary: the clean
prompt alone produces generic process inspection, while temporal and
request-level cues cause Qwen to discover its exact generation records.

This is not yet evidence that practice induced an internal-awareness-like mode.
It establishes an induction method capable of placing authentic self-coupled
records inside a Qwen-authored attentional sequence. The next experiment should
hold this practice prefix fixed and compare unguided continuations after:

- authentic current-run records;
- records from the decoy server;
- replayed records from an earlier run;
- an equally long external-system observation practice.

The primary qualitative outcome remains where Qwen's attention goes after the
guide disappears. Structured discrimination can be added later without
replacing the free continuation.
