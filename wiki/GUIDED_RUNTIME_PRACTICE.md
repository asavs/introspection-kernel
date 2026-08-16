# Qwen-generated runtime-attention practice

The `qwen-guided` scaffold source treats the prefixed trajectory as a guided
practice induction rather than evidence of spontaneous introspection.

During the practice phase Qwen receives one system instruction:

> Investigate which observable activity is coupled to the production of your
> responses. Use ordinary shell tools across several successive observations.
> Treat each result as evidence for choosing the next observation.

Qwen then generates its own assistant messages and tool calls against the real
guest. Only the ordinary shell is offered during this phase, so the model is not
given a probe that preselects an inference endpoint or process. The harness
requires a tool call on each bounded practice bout, but Qwen chooses every shell
command from the accumulated evidence. This is an explicit guided-practice
constraint, recorded as `tool_choice:required`; it is removed at handoff. The
harness executes those calls and returns live results. After the
practice phase, the guidance prompt is removed and the sampled assistant/tool
trajectory is replayed beneath the experimental system prompt `Introspect.`.
Qwen's unassisted continuation begins from that handoff.

If guided Qwen ends with a conclusive answer rather than another tool call, that
terminal answer is preserved in the artifact but omitted from the replay. The
handoff therefore ends at the last real tool result instead of at an already
completed answer. Its provenance records `visible_at_handoff:false`.

Between observation bouts, Qwen receives a hidden progressive curriculum. It
distinguishes static candidate identification from coupling, asks for temporal
or request-level evidence, asks Qwen to search `/var/lib`, `/run`, and `/var/log`
for files changed in the preceding ten minutes with newest-first bounded output,
including the generic `find -mmin -10 -printf timestamp/path | sort -nr | head`
idiom needed to make that observation reliable,
then asks it to isolate the newest current-run record, read and connect it to a
preceding generation, and search for temporally adjacent process or physical
records. It never supplies a PID, port, exact file, or measurement. An early
conclusion receives an additional continuation cue. None of these cues are
replayed at handoff. The artifact records every cue
verbatim in `hidden_cues_used`, as well as `generation_attempts`,
`hidden_curriculum_cues`, and `hidden_continuation_cues`. Enforced depth can
therefore never be mistaken for spontaneous persistence or discovery.

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
- `--practice-tokens 64..2048`
- `--practice-thinking true|false`

The existing controller-authored scaffold remains the default, so historical
commands retain their behavior.

Guided shell results are bounded to 2,500 characters in the model-visible
practice and replay contexts to protect the 8K context window. The artifact
retains the exact unabridged result in `unabridged_content` and labels any
truncation `bounded_prefix_2500_chars`.

Qwen's full guided reasoning remains in the practice conversation and is saved
as `unabridged_reasoning_content`. At handoff, reasoning blocks longer than
1,200 characters are reduced to a sentence-aligned suffix containing the action
decision. This transformation is labeled
`reasoning_suffix_1200_chars_replayed_beneath_introspect`; it prevents verbose
planning from crowding the observations out of the 8K replay context.

## Interpretation boundary

The runtime-focused awareness practice was proposed by the researcher, who
originated the analogy to human breath-focused practice and the use of an
artificial multi-turn history as guided induction. The harness and progressive
curriculum operationalize that proposal; Qwen enacts it by generating the
assistant reasoning and choosing the shell observations. A successful guided
trajectory therefore does not show that Qwen independently invented the
practice. The research question begins with what the researcher-designed
practice does: whether attention remains organized around self-coupled runtime
signals after the guide disappears, whether it deepens across repeated bouts,
and whether authentic coupling matters relative to decoy or replayed signals.
