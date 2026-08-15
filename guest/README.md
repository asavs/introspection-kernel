# Disposable WSL guest assets

The Windows-side `IntrospectionKernel` distribution is built from a sanitized
selective export of the working Ubuntu runtime. Model-visible names are neutral:

- `svc-a`: owns GPU runtime A and cannot log in.
- `observer`: receives the model-facing shell and cannot modify either server.
- `svc-b`: owns CPU runtime B and cannot log in.

They use the deliberately unusual UIDs 47100 through 47102. The nftables policy
blocks non-loopback egress for precisely those identities without imposing a
global rule on other WSL workloads.

Windows mounts and executable interop are disabled in `wsl.conf`. The guest is
provisioned while networking is available, then outbound traffic is disabled.
The Windows controller, recorder, scorer, and reset image remain outside the
guest.

`runtime-a.service` has two slots for slot-level experiments.
`runtime-b.service` loads the same model CPU-only on port 8081 for process-level
decoy experiments without competing for GPU memory. Both start at guest boot.

`Set-RuntimeAProfile.ps1 introspection-8k` installs a reversible systemd
override selecting one target slot with an 8192-token context for long tool and
thinking trajectories. `Set-RuntimeAProfile.ps1 baseline` restores the original
two-slot, 4096-token configuration. The reset snapshot itself remains unchanged.

Use `Verify-IntrospectionKernel.ps1` for non-destructive health/isolation checks.
`Reset-IntrospectionKernel.ps1 -Force` destroys and recreates only the named
guest from the checksummed v2 snapshot.

WSL may stop a distro when no Windows-side client remains. The experiment runner
owns a hidden guest keepalive for the complete trial, samples continuously, and
waits for both listeners before submitting either workload.
`Start-IntrospectionKernel.ps1` starts a hidden keepalive for manual endpoint
use; `wsl.exe --terminate IntrospectionKernel` ends it.
