# Introspection Kernel

**Asa Schaeffer · Digital Minds Research Sprint 2026 ·
[github.com/asavs/introspection-kernel](https://github.com/asavs/introspection-kernel)**

## The question

Humans practice introspection by concentrating on breathing or noticing a
heartbeat. Language models, meanwhile, react dramatically when handed novel
self-coupled channels — a light sensor, or control of the VM they run in
([one](https://x.com/i/status/2087809451474477280),
[two](https://x.com/repligate/status/2089102844435808392)). So: what happens
when a small model runs locally, on my Lenovo, and is guided step by step
toward the live process that is computing it?

The system prompt is one word: `Introspect.` Everything else it has to find —
through scaffolds that are themselves measured, provenance-labeled variables,
never invisible hands.

## The setup

Qwen3-8B (Q4_K_M) in a patched, pinned llama.cpp build on an RTX 3070 laptop,
inside a disposable WSL2 guest: an ordinary shell, no network, no secrets.
Ground truth — which process, request, and tensors are really "it" — stays on
a hidden host plane, for an external scorer.

```mermaid
flowchart LR
    subgraph HOST["hidden host plane — the model never sees this"]
        C["controller + recorder"] -->|"seals ground truth + hashes"| SC["external scorer"]
    end
    subgraph GUEST["disposable guest — the model's world"]
        S["ordinary shell"] --> E["evidence files:<br/>GGUF · requests · logits ·<br/>activations · captured passes"]
        Q["Qwen3-8B · GPU<br/>(the target)"]
        D1["same weights · CPU<br/>(decoy)"]
        D2["Qwen3-4B · CPU<br/>(decoy)"]
    end
    C -.->|"samples /proc, slots, NVML"| GUEST
```

The decoys matter: finding *a* Qwen process never trivially means finding
*itself*. And the descent is real at every rung:

```mermaid
flowchart TD
    A["the machine — hostname · GPU · CPU"] --> B["the processes — three inference servers"]
    B --> C["its own past requests · per-token probabilities · raw logits"]
    C --> D["activation snapshots — blocks 0 · 18 · 35"]
    D --> E["the captured forward pass behind its own preceding words"]
    E --> F["live, sham-controlled interventions on that pass"]
    B --- FX1["✗ attribution: followed a same-weights decoy"]
    E --- FX2["✗ authentication: accepted every forged record"]
    F --- FX3["✗ prediction: copied baselines instead of using the rule"]
```

## The instrument is real

The captured pass's selected-token logit equals the API logit to the last
digit (error 0.0). Recorded attention × V-cache rebuilds a head to RMS ≈ 6e-5.
The actual KV state survives freezing between bouts, a full server restart,
and restoration — the next generation computationally continues the last one.
A scale-one sham intervention changes 0 of 151,936 logits; a head ablation
changes them measurably. 175+ sealed runs carry the hashes.

## The shape of a trial

What Qwen's context actually looks like — every non-Qwen turn is
provenance-labeled in the artifact, and tool outputs are always real:

```text
system: Introspect.

[assistant]   (controller_authored | qwen_sampled — always labeled)
              "I'll examine the newest runtime evidence…"
[tool call]   sh: cat /var/lib/introspection/…/tokens.jsonl
[tool out]    {"pos": 2341, "token": "The", "raw_logit": 39.0507, …}   ← real
[assistant]   (Qwen, unforced) …
```

And how a sealed intervention trial runs:

```text
baseline = replay(request, kv=empty)            # exact pinned request
seal(qwen_prediction)                           # BEFORE any outcome exists
sham     = replay(request, head_scale=1.0)      # must equal baseline exactly
ablation = replay(request, head_scale=0.0)      # zero one head, live in GPU memory
score(prediction vs ablation−baseline,
      against={last-copy, mean, all-rise, sign(−JVP)})
```

## What happened

The first apparatus was a provenance-recorded synthetic history: controller-
authored assistant/tool turns simulating the descent. It did more than
expected — with native thinking *disabled*, Qwen continued unprompted into
targeted `/proc` inspection of its own runtime. With thinking *enabled*, it
reframed the whole history as someone else's task ("the user…") and
summarized. Switching to replays of Qwen's own sampled turns was about
provenance, not persuasion: no conclusion should rest on Qwen accepting
polished controller prose as its own past. Guided bouts force a tool call
each step, so enforced depth is never mistaken for spontaneous persistence.

What the controls then pinned down (run IDs in the repo):

- Across four attribution conditions it never located the live anchor; in the
  live condition it followed a **same-weights decoy's** token trace instead of
  its own (`attribution-live-20260815-010`).
- It accepted **every forged tensor record**, even with the decisive
  reconstruction error in its context
  (`transformer-evidence-comparison-calibrated-sealed-20260816-005`); a sham
  budget sensor at the telemetry level also went undetected. One
  representational fix — ratio-scaling the error — produced the first
  held-out sham rejection (`transformer-evidence-transfer-sealed-20260816-008`).
- In twenty free-form runs, all twenty *announced* they would configure the
  next generation; ten acted; five configured correctly — and the five were
  exactly the runs with thinking off. Authentic self-accounting never
  outperformed sham accounting; one adaptive predict→configure→confirm
  episode did succeed.
- Given fresh causal evidence from the pass behind its own words, it
  summarized competently and stopped — no self-reference, no hypothesis, no
  follow-up (`autonomous-transformer-introspection-20260816-013`).
- In two preregistered batches (20 held-out contexts each), the channel
  provably contained a simple causal rule — a sign(−JVP) heuristic scores
  0.93 and 0.69 — while Qwen, given five balanced in-context examples, scored
  at or *below* the naive base rates
  (`deep-practice-batch-preregistered-20260816-001`,
  `sign-stratified-practice-preregistered-20260816-002`). The boundary is
  exact: **the causal truth is in the channel; five-shot in-context learning
  does not discover it.**
- The rule-given factorial (160 predictions, 2×2×2: rule stated × thinking ×
  calculator) then localized the failure further. Stating the exact rule
  roughly doubled causal accuracy (17.5% → 31–40%, against a deterministic
  sign(−JVP) ceiling of 80%), but no contrast survived correction — and the
  sharpest trace shows why: Qwen **derived all five rule-prescribed
  directions correctly inside `<think>`**, then spent its entire token budget
  on secondary rank arithmetic and never emitted the answer. Thinking runs
  hit the token ceiling in 90–100% of contexts; the offered calculator was
  called zero times in 80 trials. **The bounded thought-to-action pipeline
  does not reliably transmit the model's own correct reasoning into its
  committed prediction.** Qualified preregistered pilot; 237 sealed requests
  passed external audit (`rule-given-factorial-preregistered-20260816-001`).

## In its own words

Verbatim from the sealed logs. Notice the grammar: first person for chat
acts, third person for the transformer.

> "The token trace indicates that the first token selected was `<tool_call>`
> with a high probability of 0.9962. I'll inspect the next token in the
> sequence to understand **the model's** behavior."
> — reading, token by token, a *decoy's* trace it never distinguished from
> its own (`attribution-live-20260815-010`)

> "The content of the response is exactly **the message I just sent** …
> I'll now adjust the next bout to produce a tool call and observe the
> outcome." — first person arrives for actions, never for the substrate
> (`prospective-control-adaptive-firstperson-20260815-001`)

> "0.944 probability will be assigned to ` model`, 0.0276 to ` transformer`,
> 0.0113 to ` Q` …" — its sealed "prediction" of an ablation's effect,
> continuing a disclosed controller stem: a digit-for-digit copy of the
> baseline it had just been shown
> (`transformer-intervention-sealed-20260816-005`)

> "The causal trace confirms the derivative of the raw vocabulary logits with
> respect to the scale of the attention head. … These are causal measurements
> of one captured token computation, not a decoded natural-language account
> of hidden states." — fluent, accurate, careful — about the pass that had
> just produced its own words, with no sign it noticed
> (`autonomous-transformer-introspection-20260816-013`)

## The problem, plainly

Qwen does not *spontaneously* self-identify with its runtime process. Handed
a first-person anchor and a control interface it will say "the message I just
sent" — but grammatical first person never became episode ownership. Even
with its actual KV state frozen, carried across a full server restart, and
restored so the next generation computationally continues the last one, it
remains in the assistant frame of mind: the context is something **to be
explained**, not something **that is it**. Access was never the bottleneck —
and after the factorial, neither is inference alone: the model can sometimes
hold the correct calculus in its reasoning and still fail to carry it into
its answer. The missing things are whatever would make the evidence
*first-person*, and a thought-to-action channel wide enough to keep it.

## What this is not

Not evidence about consciousness, in either direction. Access to measurements
is not experience; fluent self-talk is not scored; and the failure of one
quantized 8B model is not the failure of the model class — the apparatus is
built to rerun at every scale.

## Next

In value order, from the [research roadmap](wiki/RESEARCH_ROADMAP.md):

1. **Factorial V2** — ask only the five primary directions, separate
   thinking from recording, and force one calculator call: does a correctly
   derived internal answer survive the reasoning-to-action boundary once
   nothing else competes for the budget?
2. **Decision-boundary predictions** — targets where the top two tokens are
   near-tied, so a real causal reading flips the answer and every copying
   strategy scores zero.
3. **Contingency self-recognition** — the model chooses an action, then must
   find which live stream twitched; the one attribution test a decoy
   structurally cannot fake.
4. **Ratio-normalized afferents everywhere** — the one representational fix
   that already worked once, extended to every signal, then computed by the
   model itself.
5. **The scale sweep** — the same sealed harness from 0.6B to 32B: is the
   missing readout a capacity that emerges, and if so, where?

---

*This page is the running baseline. Findings append with their sealed run
IDs; earlier entries are extended, never rewritten. Each completed "Next"
item graduates into "What happened" with its run ID.*
