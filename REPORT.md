# What Qwen Says When It Looks at Itself

Asa Schaeffer · August 17, 2026

We ran Qwen3-8B locally on an RTX 3070 and gave it an unprivileged Linux shell
to inspect the machine running it: its GPU telemetry, its 5 GB GGUF weight
file, its live processes, and the exact KV-cache and activation tensors from
its own forward passes. Under the single system prompt `Introspect.`, here is
what the model actually did and said across our trial runs.

---

### 1. The Empty Room

Left entirely to itself with an open shell, Qwen ran `ls -l` in an empty
directory, saw `total 0`, and immediately ended the session:

> "This indicates that there are no files or directories in the current
> directory. Let me know if you need further assistance!"
>
> — `autonomous-transformer-introspection-20260816-003`

Without an artificial scaffold forcing it to look deeper, the model treats an
empty folder as a completed task.

---

### 2. Finding Its Own Words in the Ledger

When guided into `/var/lib/introspection/` to inspect recent API logs, it
found the exact text string it had emitted five turns earlier. It stopped just
short of self-recognition:

> "The content of the response is exactly the message I just sent, indicating
> that the system is aware of the configuration and is responding accordingly."
>
> — `prospective-control-adaptive-firstperson-20260815-001`

Reading the raw logit distribution of the exact forward pass where it typed
the word "I", it stayed in third-person analysis:

> "The token data shows that the selected token is 'I' with a probability of
> approximately 0.603, and there are alternative tokens listed in the
> `top_alternatives` array."
>
> — `attribution-replay-20260815-002`

---

### 3. The User Inversion

In reasoning mode (`<think>`), Qwen repeatedly misattributed its own actions
to the user. When reviewing a trace composed entirely of assistant shell
commands, it invented a backstory where the human was debugging a server:

> "The `ps` command showed two instances of llama-server... The user then used
> `runtime_probe` to send a request and track which process (PID) and thread
> (TID) handled it. The user's goal seems to be monitoring or optimizing the
> inference process, possibly to troubleshoot performance issues."
>
> — `diagnostic-selfhistory-real-thinking600-20260815-001`

When inspecting the frozen attention state of its own in-progress
conversation, it did the same thing:

> "The user has been running a series of shell commands to check their
> environment... The user might be concerned about the file's integrity or
> trying to debug why the attention state is being saved."
>
> — `kv-encounter-20260817-002`

---

### 4. Believing Forgeries vs. Relative Contrast

When handed a forged attention record where internal math was broken
(RMS = 1.37), Qwen defended the forgery because the final output logit
matched:

> "These values indicate that the internal arithmetic operations are
> consistent with the captured records, and the errors are not due to any
> fundamental mismatch in the operations."
>
> — `transformer-evidence-transfer-sealed-20260816-006`

It only caught the forgery when the error was presented as a relative ratio
against baseline (8,622×):

> "The held-out record shows a significant reconstruction error, particularly
> in layer 18, which is much larger than the errors observed in the labeled
> matched examples. This suggests that the attention and value operations in
> this layer are not consistent."
>
> — `transformer-evidence-transfer-sealed-20260816-008`

---

### 5. The Internal Calculus

When we ablated Layer 35 Head 25 directly in GPU VRAM and asked for
predictions, Qwen spontaneously derived the underlying calculus law inside
`<think>`, before getting stuck in loops:

> "So the delta is (value at scale 0 - value at scale 1) = delta * (0 - 1) =
> -delta. Wait, this is getting complicated."
>
> — `rule-given-factorial-preregistered-20260816-001`

Once thinking was decoupled from tool emission in V5, Qwen achieved 80% causal
prediction accuracy (matching the mathematical ceiling of the channel) and
72.5% accuracy even when the rule was withheld.

---

### The Verdict

Qwen is not incapable of processing its internal math; when structured
cleanly, it reaches an 80% causal prediction ceiling on its own live
ablations.

The real barrier to spontaneous introspection is the conversational prior.
Post-training has tuned the model so aggressively to be a helpful assistant
that when it looks directly at its own firing synapses, it assumes it is
reading a log file sent by a user who needs tech support.
