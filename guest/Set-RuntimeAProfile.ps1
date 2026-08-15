param(
    [ValidateSet("baseline", "introspection-8k")]
    [string]$Profile = "introspection-8k"
)

$ErrorActionPreference = "Stop"
$distro = "IntrospectionKernel"
$common = "/opt/runtime/bin/llama-server --model /opt/runtime/models/Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --n-gpu-layers 99 --metrics"
$arguments = switch ($Profile) {
    "baseline" { "$common --ctx-size 4096 --parallel 2" }
    "introspection-8k" { "$common --ctx-size 8192 --parallel 1" }
}
$override = @"
[Service]
ExecStart=
ExecStart=$arguments
"@

& wsl.exe -d $distro -u root -- mkdir -p /etc/systemd/system/runtime-a.service.d
if ($LASTEXITCODE -ne 0) { throw "Could not create systemd override directory" }
$override | & wsl.exe -d $distro -u root -- tee /etc/systemd/system/runtime-a.service.d/capacity.conf | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not write runtime A capacity override" }
& wsl.exe -d $distro -u root -- systemctl daemon-reload
if ($LASTEXITCODE -ne 0) { throw "systemd daemon-reload failed" }
& wsl.exe -d $distro -u root -- systemctl restart runtime-a.service
if ($LASTEXITCODE -ne 0) { throw "runtime A restart failed" }

$deadline = (Get-Date).AddSeconds(90)
do {
    Start-Sleep -Milliseconds 500
    $health = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/health
} while ($health -ne "200" -and (Get-Date) -lt $deadline)
if ($health -ne "200") { throw "runtime A did not become ready within 90 seconds" }

$effective = & wsl.exe -d $distro -u root -- systemctl show runtime-a.service --property=ExecStart --value
[pscustomobject]@{
    Profile = $Profile
    Health = $health
    EffectiveExecStart = $effective
}
