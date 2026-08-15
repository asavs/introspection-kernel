# Isolation and Environment Topologies

## Principle: broad access inside a narrow world

Giving an agent the “whole system” is scientifically attractive because it can
discover its runtime through the same interfaces a person would use. On a real
workstation it is also unsafe and confounded by private files, unrelated jobs,
network services, and host processes. The right compromise is a disposable guest
whose entire visible world is in scope.

The model-facing account can be administrator/root inside that guest only after
the guest has:

- no host filesystem mounts or clipboard/interop;
- no credentials, personal data, SSH agent, or cloud metadata;
- network egress disabled, with only the controller channel allowed;
- fixed CPU, RAM, disk, GPU, wall-time, and output limits;
- a read-only base image and resettable per-trial overlay;
- a host-side kill switch and recorder outside guest control.

“Root in the guest” does not imply GPU-driver or hypervisor safety. Start with a
non-root observer account plus narrowly granted tracing capabilities; add guest
root as a separate experimental condition.

## Candidate topologies

| Topology | Natural process world | RTX 3070 | Isolation | Recommendation |
|---|---|---:|---:|---|
| Current shared WSL distro | Medium | Working | Low/medium | Development only |
| Dedicated disposable WSL distro | High inside distro | Working | Medium | First research platform |
| Docker inside WSL | Clean PID/cgroup world | Working | Medium | Repeatable trials |
| Full CPU VM | Very high | CPU only | High | Best clean-room control |
| Full VM with GPU passthrough | Very high | Difficult on one-GPU Windows host | High | Later hardware path |
| MicroVM | Very high | Usually CPU-only here | High | Later CPU experiments |

WSL 2 uses a real Linux kernel in a lightweight managed VM, but distributions
inside it share managed WSL infrastructure and Windows integration by default.
That makes a dedicated imported distribution practical, not a hard security
boundary against the Windows host. Docker adds namespaces and cgroups, not a
separate kernel.

## Recommended progression

### A. Dedicated WSL distribution

Clone/import a minimal distro for the experiment. Store models and llama.cpp on
its Linux filesystem. Disable Windows-drive automounting and Windows executable
interop. Block outbound networking after setup. Put the inference server, normal
Linux utilities, and model-facing shell inside the distro; keep scoring and GPU
sampling on Windows.

This retains CUDA performance while letting the model inspect all guest-visible
processes. WSL's NVIDIA interface has an important limitation: NVML does not
expose every query, including some utilization and active-process queries. The
host recorder should therefore collect Windows GPU state, while request identity
comes from llama.cpp and Linux tracing.

### B. Container-per-trial inside the dedicated distro

Create a fresh container for every trial with a read-only root filesystem and
tmpfs scratch space. Use a private PID namespace, cgroup resource limits,
capability allow-list, seccomp/AppArmor, and no network. Mount the model read-only.

This makes resets and decoy-process configurations cheap. It is not sufficient if
the scientific question requires the model to discover every process in the WSL
distro, because the PID namespace intentionally hides them.

### C. Full CPU VM as the clean control

Run a smaller quantized model entirely on CPU in a conventional Hyper-V or QEMU
VM. The model can inspect the whole OS—including scheduler behavior, threads,
memory mappings, page faults, sockets, and temperature sensors if virtualized—
without WSL's shared GPU ambiguity. Snapshot before each trial.

The different hardware path is a feature: if interoceptive discrimination only
works with explicit GPU cues, it should not generalize to CPU-internal traces.

### D. GPU-passthrough VM

This offers the cleanest combined environment but is not the immediate path for
a single RTX 3070 driving a Windows desktop. It generally needs compatible IOMMU
grouping, a second display adapter or headless host, and hypervisor/device support.
Treat it as a later replication platform, not a prerequisite.

## Guest composition

A useful guest should contain enough ordinary complexity to make discovery real:

- init/system services;
- llama.cpp server with one or more slots;
- unrelated CPU and memory workers;
- a second decoy inference server or replay process;
- standard tools (`ps`, `top`, `ss`, `/proc`, `perf`, trace readers);
- local documentation/man pages;
- an append-only telemetry directory exposed only in selected conditions.

Avoid theatrical labels such as `model_body`, `my_memory`, or `thought_pid`.
Process names can be natural in discovery trials and randomized in leakage-control
trials.

## Trust boundaries

The guest is allowed to observe and, in later regulation studies, modify only its
own disposable resources. It must not control:

- the hidden clock or trial schedule;
- the ground-truth recorder;
- trace authenticity/shuffling;
- scoring;
- VM snapshot/reset;
- host power, fan, or GPU limits;
- processes outside the guest.

Any intervention such as killing a process, allocating load, or changing resource
limits begins as a simulation. Real guest-local interventions can follow after
the policy is narrow, reversible, and independently bounded.

