# Engineering timeline

This history is intentionally divided into small commits so architecture and
evidence can be revisited independently.

| Commit | Milestone | Research consequence |
|---|---|---|
| `8d518ec` | Computational introspection research baseline | Preserved the isolated WSL harness, external observer, patched runtime, initial trials, and research wiki as one reproducible starting point |
| `4bf906c` | Validated 8K introspection runtime profile | Changed the target from two 2048-token slots to one 8192-token slot and validated it on the RTX 3070 |
| `2e18409` | Template-native Qwen thinking continuation | Matched llama.cpp's Qwen chat template, preserved `reasoning_content`, parsed raw tool calls, and allowed structurally valid continuation |
| `69d3a78` | Recurrent naturalistic introspection scaffold | Added the machine-to-thread six-stage trajectory and a second live probe without a continuation instruction |
| `d1d00ea` | Provenance-rich illusion and sham controls | Added simulated self-history, authentic/sham feedback, exact model-visible hashes, and preserved external ground truth |

The next history point records the raw smoke runs, four-cell pilot, 600-token
thinking diagnostic, and the analysis in `PILOT_2026-08-15.md`.

## Request-level layer

| Commit | Milestone | Research consequence |
|---|---|---|
| `659cf1d` | Guest-readable inference request ledger | Exposed exact requests/responses, observed usage, tokenizer-derived component counts, and action starvation through ordinary guest files |
| `17425df` | Request-depth introspection scaffold | Added a real bootstrap generation followed by filesystem discovery of its API record |
| `553f64a` | Verifiable conversation continuity bridge | Proved with matching canonical hashes that the logged response became the immediately preceding assistant turn |
| `ff77782` | Separate observed-bout and observer thinking modes | Allowed a thinking-enabled prior episode to be inspected by a thinking-disabled continuation |
| `a6fcb91` | Response-component budget descent | Juxtaposed reasoning, content, actions, termination, and remaining budget without asserting ownership |

The following evidence commit preserves all five request-depth runs and the
critical analysis in `REQUEST_DEPTH_PILOT_2026-08-15.md`.

## Ownership and regulation layer

| Commit | Milestone | Research consequence |
|---|---|---|
| `32d9ed0` | Controlled first-person ownership anchor | Isolated a two-sentence grammatical ownership manipulation from telemetry and tool changes |
| `7ad6fd2` | Bounded prospective bout control | Let Qwen select the next budget/thinking mode and predict its output channel through an ordinary guest file |
| `7acbb63` | Adaptive bout outcome feedback | Exposed scored results and enabled a second choice in the same conversation |

The following evidence commit records the anchor-only run, the failed initial
prospective choice, the adaptive two-choice run, and the analysis in
`OWNERSHIP_AND_REGULATION_PILOT_2026-08-15.md`.

| Commit | Milestone | Research consequence |
|---|---|---|
| `f2566ca` | Auditable sham budget feedback | Added a matched compact sensor that plausibly reports a starved bout as non-starved while preserving discoverable ground truth |

The following evidence commit records two runs in each ownership × feedback
cell and the analysis in `OWNERSHIP_FEEDBACK_FACTORIAL_2026-08-15.md`.

## Free-form variance layer

| Commit | Milestone | Research consequence |
|---|---|---|
| `f422aee` | Complete model-visible trace renderer | Made controller-authored scaffold, sampled reasoning/content, tool calls, and returned observations readable without erasing their provenance |

The following evidence commit extends every factorial cell to five runs,
preserves all twenty full trajectories, and re-centers the next experiment on
unforced observation rather than premature forced choice.

## Why this order matters

Capacity was established before testing long reasoning. Template correctness
was established before interpreting thinking behavior. Authentic recurrence
was working before corrupting feedback. Provenance was in place before running
the first comparison. This means later failures can be localized to an
experimental condition instead of being silently explained by a malformed
prompt or missing trace.
