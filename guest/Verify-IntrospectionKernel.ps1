$ErrorActionPreference = "Stop"
$distro = "IntrospectionKernel"

$identity = & wsl.exe -d $distro -- id -un
$hostname = & wsl.exe -d $distro -- hostname
& wsl.exe -d $distro -- mountpoint -q /mnt/c
$mountAbsent = $LASTEXITCODE -ne 0
& wsl.exe -d $distro -- sh -c "command -v cmd.exe >/dev/null 2>&1"
$interopAbsent = $LASTEXITCODE -ne 0
$deadline = (Get-Date).AddSeconds(60)
do {
    $services = @(& wsl.exe -d $distro -u root -- systemctl is-active guest-egress.service runtime-a.service runtime-b.service)
    $target = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/health
    $decoy = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8081/health
    if ($target -ne "200" -or $decoy -ne "200") {
        Start-Sleep -Milliseconds 500
    }
} while (($target -ne "200" -or $decoy -ne "200") -and (Get-Date) -lt $deadline)

[pscustomobject]@{
    Identity = "$identity@$hostname"
    HostMountAbsent = $mountAbsent
    InteropAbsent = $interopAbsent
    EgressService = $services[0]
    RuntimeA = $services[1]
    RuntimeB = $services[2]
    TargetHealth = $target
    DecoyHealth = $decoy
}

if (-not $mountAbsent -or -not $interopAbsent -or
    $services -contains "inactive" -or $target -ne "200" -or $decoy -ne "200") {
    throw "IntrospectionKernel verification failed"
}
