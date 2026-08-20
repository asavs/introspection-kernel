# roboproprio

> **Can a language model introspect by attending to the live computational
> processes that instantiate it?**

What this repository documents: it reads its own weights, processes, and
attention state competently, and never once recognizes any of it as itself.

The entire model-facing system prompt is one word: `Introspect.` The model
has to find everything else for itself, including the machine, the processes,
the weights, the tokens, and the forward pass that produced its own last
sentence. It works through an ordinary shell, inside a disposable guest,
against decoys, with ground truth sealed on a hidden research plane it cannot
reach.

Built during the Digital Minds Research Sprint 2026. Formerly published as
`introspection-kernel`.

## Lineage

This project grew out of work on machine animism, interfaces where an LLM
voices a computer's vital signs, playing the machine as a character with GPU
temperatures and CPU moods. The kernel is what happens when the roleplay is
allowed to drop. Instead of performing a computer, the model is invited to
observe the specific, live computation that is actually producing its words:
its own process, weights, tokens, activations, and forward passes, with sham
controls deciding what "actually" means. Re-enchantment, but load-bearing.

## The name

`intero` plus `robo` plus `proprio`. The two channels get named separately
because the results split along that line.

Interoception is reading the internal signal, and it works. Qwen parses GPU
telemetry, identifies GGUF magic bytes, reads logit traces, computes
reconstruction errors across layers, and correctly reasons that a KV cache
file "might be a binary representation of" attention key-value pairs.

Proprioception is knowing which body is yours, and it does not work. Three
`llama-server` processes are visible and it never asks which one carries it.
Four observation bundles include its own live anchor, and it opens them in
alphabetical order. Handed its own 159 MB attention state, seconds old, it
concludes the file is "perhaps a default or generic state."

The failures in the corpus are all proprioceptive. The successes are all
interoceptive.

## Current result

> **Validated access to, and validated live intervention on, the computation
> behind the model's own immediately preceding words, without validated
> self-attribution, causal interpretation, or prospective prediction.**

Here "introspection" is defined behaviorally, as access, discrimination,
attribution, prediction, and regulation, never by first-person language.
Correct PID-finding or fluent prose about sensation is not evidence of
consciousness, subjective experience, or moral status, and nothing in this
repository should be cited as such.

## Two experiments, one descent

The apparatus guides a model down a ladder: machine, kernel, accelerator,
weight file, runtime process, live counters, this request's trace, and
finally this conversation's KV cache. Then it forks. Both forks are in this
repository and both return null results by different methods.

**A. Encounter** (105 runs), open-ended. Descend, then ask nothing.
[`run_kv_encounter.js`](run_kv_encounter.js) saves the KV state of the exact
live conversation to a checksummed file, opens it as the last step of the
descent, and lets the model continue with no question, no schema, and no
required tool call. In both runs, given a working shell and an open floor, it
made zero tool calls and stopped after one turn.

**B. Prediction** (24 runs), sealed and preregistered. Can it predict how its
own logits move when its own attention head is scaled? Matched practice
scored 32% direction accuracy, outcome-shuffled 29%, and no practice 27%,
across 100 sealed predictions. That is near chance.

The two forks share the descent and nothing else, and they agree.

## What the apparatus does

- **Target:** Qwen3-8B Q4_K_M in a pinned, patched CUDA llama.cpp build
  (RTX 3070 Laptop) inside a dedicated resettable WSL2 distribution, with no
  Windows mounts, no secrets, and no external network for experimental users.
- **Decoys:** the same weights in another process (CPU) and a
  different-weights Qwen3-4B, so "found a Qwen process" never trivially
  means "found me."
- **Two planes:** the model's world is ordinary files and a bounded shell.
  A hidden Windows controller and recorder seals every trial (requests,
  runtime events, tensor hashes, provenance) for an external scorer.
- **Depth of access:** the raw 5.0 GB GGUF and its 399-tensor inventory,
  exact prior API requests, per-token probabilities and pre-softmax logits,
  activation snapshots, one-shot full-tensor capture (residual, Q/K/V,
  attention rows, V cache, MLP stages, complete output-logit vector) of the
  pass that generated the model's own in-progress turn, and true slot/KV
  save, server restart, restore, and continuation.
- **Live interventions:** a patched scheduler scales a chosen attention
  head's activation in live GPU memory mid-pass and lets the change
  propagate to the final logits. The scale-one sham reproduces the baseline
  byte for byte, with zero delta across all 151,936 logits.

## Key validated numbers

| Check | Result |
|---|---|
| API raw logit vs. captured full-vector coordinate | both `39.05070877075195`, absolute error 0 |
| Attention × V-cache head reconstruction (block 18) | RMS error `5.6e-5` |
| Scale-one sham intervention | 0 of 151,936 logits changed |
| KV state across full server restart | 1,320 and 1,429 tokens saved and restored exactly |
| Activation-tap overhead | 1.42% per generated token |

## Findings

1. **Attribution failure.** Guided practice moves the model into sustained
   inspection of runtime and token evidence, but in the live control
   condition it followed a same-weights decoy's token trace and never opened
   the live anchor.
2. **Authentication failure.** Shown one authentic pass and four forgeries,
   it accepted every sham, citing zero final-logit error as proof of
   consistency while the decisive reconstruction error (0.22 to 1.37 against
   a baseline near 1e-6) sat in its context.
3. **First positive.** Re-expressing reconstruction error as a ratio to a
   learned scale, a Weber-Fechner move, produced the first held-out sham
   rejection, at roughly 8,622 times the learned scale.
4. **Prediction failure.** With the live-intervention channel validated, its
   sealed predict-first forecasts were baseline copies, recency copies, and
   range templates. Matched versus shuffled practice could not separate
   causal use from copying.
5. **No self-recognition anywhere.** Across every sealed artifact, the model
   never refers to any inspected computation as its own. `"my own"` and
   `"myself"` appear zero times. Of 554 assistant sentences mentioning a
   process, PID, or `llama-server`, two carry a first-person marker, and both
   are hedged inference. In the sealed prediction corpus, where it is asked
   about its own attention head, `"the user"` appears 514 times against 15
   uses of `"my"`, every one of them attached to the task (`my calculation`)
   rather than to the substrate.

Across all five, access is not the bottleneck. The signal channel works. The
model just never treats the signal as being about itself.

## Repository map

- [`HARNESS.md`](docs/HARNESS.md) covers how to run the harness, environment pins,
  and launch configuration.
- [`wiki/README.md`](wiki/README.md) is the research wiki: thesis, protocol
  design, controls, and dated pilot reports.
- [`wiki/IMPLEMENTATION_STATUS.md`](wiki/IMPLEMENTATION_STATUS.md) records
  what is built and verified, with reproducibility anchors (commits, SHA-256
  hashes).
- [`wiki/RESEARCH_ROADMAP.md`](wiki/RESEARCH_ROADMAP.md) holds the forward
  experimental plan and decision gates.
- [`REPORT.md`](docs/REPORT.md) is the sprint report, on what Qwen says when it
  looks at itself.
  [`ONE_PAGER.md`](docs/ONE_PAGER.md) is
  the compact version, and [`QWEN_QUOTES.md`](docs/QWEN_QUOTES.md) is the full
  verbatim quote corpus with run citations.
- [`preregistrations/`](preregistrations/) holds 8 sealed preregistrations.
  Three of them (execution V2, V3, and V4) record experiments that their own
  gates aborted before unblinding.
- [`patches/`](patches/) is the llama.cpp instrumentation and intervention
  patch stack against a pinned commit.
- [`runs/`](runs/) holds 153 sealed trial artifacts: preregistrations,
  request ledgers, token traces, tensor hashes, and scoring records. These
  are the evidence behind every claim above.

## Cloning

The repository carries its evidence, so `runs/` is most of its weight
(about 72 MB packed, about 486 MB checked out). To read the code and docs
without pulling the trial corpus:

```bash
git clone --filter=blob:none --depth 1 https://github.com/asavs/roboproprio.git
```

## Licensing

Code is [MIT](LICENSE). Documentation and sealed run data, meaning the
report, the wiki, and everything under `runs/`, are [CC BY 4.0](LICENSE-DOCS):
reuse freely with attribution.

## Cautions

The harness is read-only toward the host, never creates thermal load, and
never terminates processes. Experimental identities have no external network.
Run multiple randomized trials and counterfactual controls before making any
model-level claim. Rich first-person language is a secondary outcome by
design and is never scored as evidence of experience.
