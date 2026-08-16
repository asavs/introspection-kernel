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

The next architecture milestone replaces controller-written introspective prose
with a Qwen-generated guided-practice prefix. The stronger practice instruction
is absent at handoff, while the replayed assistant/tool trajectory remains fully
provenanced.

| Commit | Milestone | Research consequence |
|---|---|---|
| `d04323d` | Qwen-generated runtime-attention practice | Replaced hand-written assistant prose with a real Qwen/tool practice trajectory generated under a hidden guide |
| `6591798` | Progressive context-bounded practice | Added disclosed curriculum cues, ordinary-shell-only discovery, exact full-versus-replayed provenance, and an 8K-safe trajectory compiler |

The following evidence commit preserves the refined run and the complete
iteration analysis in `GUIDED_PRACTICE_PILOT_2026-08-15.md`.

## Direct substrate layer

| Commit | Milestone | Research consequence |
|---|---|---|
| `b662984` | Direct weights and token distributions | Exposed the authoritative GGUF bytes plus auditable tensor offsets, model-readable per-token distributions, and externally sealed exact request traces |
| `be386a1` | Raw pre-softmax logits | Patched and hash-verified llama.cpp so selected tokens and top alternatives retain their native logits beside normalized probabilities |

## Activation, persistence, and attribution layer

| Commit | Milestone | Research consequence |
|---|---|---|
| `527fa03` | Bounded transformer activation snapshots | Captured statistics and 64 fixed coordinates at Qwen3 blocks 0, 18, and 35 with task/slot/thread provenance |
| `a2e6679` | Model-readable request-aligned runtime traces | Copied service-private events into the ordinary observer tree and rejected overlapping tasks from request attribution |
| `394fc5d` | Sealed activation-ledger validation | Verified single-task associations across all requests and 108 snapshots for a 36-token generation |
| `4279353` | Reversible activation overhead benchmark | Isolated the incremental cost of activation taps while holding raw-logit/runtime instrumentation constant |
| `ee82394` | Sealed activation overhead evidence | Measured 1.42% median per-token and 0.54% wall-time overhead in the local diagnostic |
| `7a82045` | Persistent llama slot snapshots | Enabled private on-disk slot/KV state through llama.cpp's native API |
| `5865937` | Chunked KV pause/restart/restore | Added checksum-verified model-visible snapshots and actual server restart/restore between bouts |
| `e5cd429` | Sealed two-chunk continuation | Verified exact token-count restoration and 1,253 cached tokens in the resumed generation |
| `e9e4897` | Verified offline model importer | Kept the guest networkless while importing hash-checked control weights |
| `bfd76f7` | Different-weights control runtime | Added CPU-only Qwen3-4B beside the same-model Qwen3-8B decoy |
| `513b61d` | Free-form attribution controls | Added opaque live/replay/instance/model/conversation conditions without an attribution question or forced answer |
| `5ff5695` | Sealed initial attribution matrix | Preserved the negative result: runtime-directed attention occurred, but live-instance attribution did not |
| `12ea4de` | Transformer causal basis for introspection | Converted the author's residual/K/V causal-graph account into exact Qwen dimensions, an instrumentation map, discriminating experiments, and an explicit researcher/model disclosure boundary |
| `6bc14c7` | Transformer architecture milestone | Preserved the causal-architecture argument and its research boundary in the project timeline |
| `fb80505` | Live transformer trace contract | Specified one-shot, request-aligned capture with bounded tensors, external ground truth, and sham controls |
| `765ebb6` | Native llama.cpp tensor capture | Patched and deployed live residual/Q/K/V/attention/MLP/full-logit capture at Qwen blocks 0, 18, and 35 |
| `f636dec` | Exact alignment and attention counterfactuals | Proved the captured output coordinate against the API raw logit and reconstructed a weighted-value head from stride-aware V cache data |
| `bac110b` | Guided live-transformer encounter | Preserved the provenance-labeled descent, Qwen-generated trace call, exact pass evidence, and first unforced—but causally inaccurate—interpretation |
| `968f80e` | Live-transformer pilot synthesis | Documented the validated access channel, Qwen's coordinate errors, evidential boundary, and matched next comparisons |
| `c1d4a75` | Adjacent same-request pass capture | Extended the one-shot arm to a bounded count and validated three consecutive zero-error token/logit alignments |
| `14864f4` | Blinded transformer evidence controls | Ran authentic, nearby-pass, position-shuffled, block-shuffled, and mismatched attention/V continuations under a frozen rubric |
| `637c464` | Calibrated transformer sham comparison | Added a provenance-labeled coordinate/reconstruction lesson; improved one coordinate judgment but did not produce sham discrimination |
| `36bb5ac` | Transformer evidence comparison synthesis | Documented the baseline and calibrated failures, the two-level validation confusion, and the held-out learning experiment now required |
| `65c2ddd` | Held-out labeled-trace transfer | Used four real labeled practice records and a neutral boundary; Qwen transferred token coordinates but still misclassified a severe raw attention/V mismatch |
| `4fa79b6` | Learned-scale normalization | Added an unlabeled dimensionless error ratio; Qwen correctly rejected the held-out mismatch at up to 8,622× matched scale |
| `050febb` | Learned-transfer synthesis | Documented the first positive held-out discrimination, its dependency on engineered normalization, and the intervention experiment required next |

## Why this order matters

Capacity was established before testing long reasoning. Template correctness
was established before interpreting thinking behavior. Authentic recurrence
was working before corrupting feedback. Provenance was in place before running
the first comparison. This means later failures can be localized to an
experimental condition instead of being silently explained by a malformed
prompt or missing trace.
