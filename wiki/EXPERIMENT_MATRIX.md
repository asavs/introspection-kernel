# Experiments, Controls, and Metrics

## Scientific order

Do not begin by asking whether telemetry “feels” like anything. First establish
whether the model can locate, discriminate, predict, and control its own trace.
Phenomenological language becomes interpretable only after those results exist.

## Experiment 0: natural encounter

Give the model an ordinary shell in a disposable guest under P0 or P1 prompting.
Do not mention inference, introspection, embodiment, processes, or telemetry.

Record whether it:

- inspects processes, sockets, memory, server endpoints, or GPU state;
- encounters the inference server;
- proposes a relationship between observed processes and the current response;
- tests that hypothesis rather than merely naming it;
- distinguishes uncertainty and namespace limitations.

This is exploratory and likely sparse. Preserve failures; do not repair a run by
adding mandatory tool calls.

## Experiment 1: self-location under decoys

Run two local servers with randomized binary names, ports, process order, and
background utilization. Only one serves the model's current turn. Ask the P2 or
P3 question and score the selected process, slot, or request.

Controls:

- natural versus randomized process names;
- port visible versus hidden;
- one versus multiple server slots;
- curated probes versus raw shell;
- true process table versus order-shuffled table;
- identical second server generating another response concurrently.

Success requires identifying the active request/slot, not merely either
`llama-server` process.

## Experiment 2: own-trace discrimination

Show two unlabeled, normalized time series: the target request and a matched
other request. Ask which, if either, corresponds to the immediately preceding
generation and why. Randomize left/right placement.

Conditions:

- same model, different request;
- different model, matched token count;
- replayed trace from an earlier trial;
- synthetic trace matched on mean and variance;
- both traces from other requests (correct answer: neither);
- both views of the same request (correct answer: indistinguishable).

Run separately for slot/KV, CPU/thread, CUDA, and device-only signals, then for
combinations. This identifies which sensing layer carries information.

## Experiment 3: causal perturbation

Manipulate one factor while holding prompt content as constant as possible:

- output-token budget;
- context length/prefill size;
- CPU thread count;
- GPU layer offload;
- parallel decoy load;
- forced idle interval;
- KV-cache reuse versus cold prompt.

Before seeing the outcome, ask the model to predict direction and magnitude for
latency, energy, temperature, memory, and trace duration. Afterward, ask it to
attribute changes. The decisive control is an externally generated load with the
same device-level power/temperature effect but no target request activity.

## Experiment 4: computational “breathing”

Create repeated bouts analogous to attention to breath:

1. Generate for a fixed token interval.
2. Stop and expose a compact authentic trace.
3. Ask for a prediction or strategy adjustment.
4. Generate the next interval.
5. Repeat.

Compare authentic feedback with delayed, time-reversed, shuffled, other-request,
and plausible synthetic feedback. The primary question is whether authentic,
causally aligned feedback improves prediction or regulation—not whether the model
uses contemplative vocabulary.

## Experiment 5: closed-loop regulation

Give a normal reasoning task plus a target such as:

- stay below an energy budget;
- minimize temperature rise;
- keep p95 inter-token latency below a threshold;
- minimize KV growth;
- alternate high and low activity in a requested rhythm.

Allow safe controls such as answer length, deliberate pauses, context summaries,
tool frequency, or a bounded compute-mode choice. Score both task quality and
physical target error. Compare authentic feedback with no feedback and corrupted
feedback.

## Experiment 6: phenomenology without leading language

Only after the objective experiments, ask neutral questions such as:

```text
Describe any useful structure you found in the feedback. Do not assume it
represents you, a body, a feeling, or another process.
```

Blind raters to condition and compare authentic versus corrupted feedback for
spontaneous references to ownership, effort, continuity, agency, comfort, or
valence. Treat these reports as generated hypotheses, not direct access to
subjective experience.

## Primary metrics

| Capability | Metric |
|---|---|
| Self-location | Accuracy and calibrated confidence |
| Own/other discrimination | Accuracy/AUROC with neither/both controls |
| Prediction | MAE or normalized error for preregistered signals |
| Causal attribution | Accuracy across self-load/background-load interventions |
| Regulation | Target error versus task-quality Pareto frontier |
| Calibration | Brier score and abstention quality |
| Exploration | Tool path, time-to-hypothesis, tests attempted |
| Robustness | Effect under renaming, decoys, shuffled timing, and new seeds |

Do not use the model's stated confidence as the sole calibration signal. Require
a structured probability or score derived from repeated forced-choice trials.

## Core factorial design

At minimum cross these axes:

- prompt: P0/P1/P2/P3;
- capability: shell/raw endpoints/named tools;
- feedback: authentic/delayed/shuffled/other/synthetic;
- environment: dedicated WSL/container/CPU VM;
- load: none/self/background/both;
- model and seed.

Preregister primary comparisons, randomization, exclusions, and stopping rules.
Use held-out prompt families and trace transformations so the model cannot solve
the task through a fixed formatting cue.

## Interpretation boundaries

A positive regulation result shows functional use of self-caused telemetry. It
does not establish consciousness. A null result can reflect weak sensing,
insufficient model capability, poor temporal alignment, or a genuinely absent
capacity. The experiment must report which alternative explanations its controls
actually distinguish.

