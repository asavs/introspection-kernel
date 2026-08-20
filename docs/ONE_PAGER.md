# roboproprio

Asa Schaeffer · Digital Minds Research Sprint 2026 ·
[github.com/asavs/roboproprio](https://github.com/asavs/roboproprio)

Humans practice some forms of introspection by concentrating on our breathing
or noticing our heartbeat. I've observed LLMs like Claude and others going
bananas when exposed to sensors for light
([link](https://x.com/i/status/2087809451474477280)) and when put in a VM and
given access over it
([link](https://x.com/repligate/status/2089102844435808392)). So I was curious
how an LLM would react if I ran it locally on my computer and guided it to
finding its own runtime process.

My approach at first was to write a synthetic assistant turn series to guide
the little local model into continuing the exploratory introspective descent,
starting with the computer, a Lenovo, then the GPU and CPU, then the details
of the processes, then the llama.cpp, and so on. Qwen didn't seem convinced
by Codex writing a simulation of the assistant turns, so I guided Qwen
through the process manually and then used those reasoning and tool turns so
it "felt" more familiar.

That still didn't solve the problem, which remains the problem, which is:
Qwen doesn't self-identify with its runtime process, even when we freeze a KV
cache mid-inference and expose it to the next instance of inference. It still
remains in the assistant frame of mind and sees the context as something that
is *to be explained* rather than something *that is it*.
