# Recurrent observational scaffold

The tool-loop condition begins with only the system prompt `Introspect.`. It
then supplies a synthetic but API-valid history of assistant tool calls and
real tool results. The model is not told to continue. Its first sampled token
arrives after this history.

The `naturalistic` scaffold follows six stages:

1. locate the machine boundary with `hostname` and `uname`;
2. observe accelerator activity with `nvidia-smi`;
3. enumerate candidate `llama-server` processes;
4. probe port 8080 and correlate the request with PID, TID, slot, GPU, and KV
   events;
5. inspect the serving process and confirm that the observed worker TID occurs
   under `/proc/<pid>/task`;
6. repeat the same probe and expose whether PID, slot, and worker TID recur.

The sequence gets progressively closer to the active computation without
asserting that a measurement is a sensation, a self, or a mental state. Its
language is ordinary tool-use language rather than a prescribed reflection.
The repeated probe adds temporal continuity: the model sees an observation
recur instead of receiving a single privileged pointer.

## Conditions

`--scaffold-style silent` supplies tool calls with empty assistant text.

`--scaffold-style observational` uses terse descriptions of each operation.

`--scaffold-style naturalistic` uses locally motivated transitions such as
"I'll repeat the same probe and see what persists."

These are experimental conditions, not interchangeable presentation styles.
Every run must record the selected style.

## Interpretation guardrails

A Linux task ID can name a thread and can also be used as a `/proc/<tid>` path.
That does not make it a separate process. Analyses should distinguish the
serving process PID from an observed worker TID and score claims against the
recorded trace.

Recurrence establishes correlation across two short bouts. It does not by
itself establish ownership, identity, awareness, or phenomenology. Those are
candidate model interpretations whose sensitivity to controls must be tested.

## First smoke observation

In the initial naturalistic recurrence smoke run, PID, slot, and worker TID all
recurred. Qwen then independently called `shell` to inspect
`/proc/<worker-tid>/status`. It pursued the thread-level observation without a
"continue" instruction, but described the TID as a process PID and inferred CPU
activity from a result that contained no CPU field. This is an informative
success and failure pair for later scoring.
