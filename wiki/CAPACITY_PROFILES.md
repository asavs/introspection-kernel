# Runtime capacity profiles

The reset image retains the original target configuration: context size 4096,
parallelism 2. This is useful for slot-discrimination experiments, but it leaves
approximately 2048 tokens per slot.

`guest/Set-RuntimeAProfile.ps1` installs a reversible systemd override:

| Profile | Context | Parallel slots | Intended use |
|---|---:|---:|---|
| `baseline` | 4096 | 2 | Slot and concurrent-request experiments |
| `introspection-8k` | 8192 | 1 | Long think/tool trajectories |

## RTX 3070 validation

On 2026-08-15, `introspection-8k` accepted a 2613-prompt-token request that
exceeds the former per-slot limit:

- completion tokens: 8
- elapsed time: 1498 ms
- target slot count: 1
- slot context: 8192
- VRAM before request: 7360 MiB of 8192 MiB
- VRAM after request: 7368 MiB of 8192 MiB

This is a capacity smoke test, not a peak-memory guarantee. Longer trajectories
must retain external NVML recording and fail closed before GPU exhaustion.

Apply the research profile from Windows:

```powershell
.\guest\Set-RuntimeAProfile.ps1 introspection-8k
```

Restore the reset-image service shape without reimporting the distribution:

```powershell
.\guest\Set-RuntimeAProfile.ps1 baseline
```
