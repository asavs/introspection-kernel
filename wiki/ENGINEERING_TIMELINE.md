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

## Why this order matters

Capacity was established before testing long reasoning. Template correctness
was established before interpreting thinking behavior. Authentic recurrence
was working before corrupting feedback. Provenance was in place before running
the first comparison. This means later failures can be localized to an
experimental condition instead of being silently explained by a malformed
prompt or missing trace.
