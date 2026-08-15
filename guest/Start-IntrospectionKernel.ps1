$ErrorActionPreference = "Stop"
$distro = "IntrospectionKernel"
$arguments = @("-d", $distro, "-u", "root", "--", "sleep", "infinity")
Start-Process -FilePath "wsl.exe" -ArgumentList $arguments -WindowStyle Hidden | Out-Null

$deadline = (Get-Date).AddSeconds(60)
do {
    Start-Sleep -Milliseconds 500
    $target = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/health
    $decoy = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8081/health
} while (($target -ne "200" -or $decoy -ne "200") -and (Get-Date) -lt $deadline)

if ($target -ne "200" -or $decoy -ne "200") {
    throw "Guest started but runtimes were not ready within 60 seconds"
}
Write-Host "$distro is ready: target=$target decoy=$decoy"

