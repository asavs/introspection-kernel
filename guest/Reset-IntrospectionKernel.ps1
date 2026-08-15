param(
    [string]$SnapshotPath = "$env:USERPROFILE\WSL\snapshots\IntrospectionKernel-clean-v2-20260815.tar.gz",
    [string]$InstallPath = "$env:USERPROFILE\WSL\IntrospectionKernel",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$distro = "IntrospectionKernel"

if (-not $Force) {
    throw "Reset destroys and recreates the IntrospectionKernel distro. Re-run with -Force."
}
if (-not (Test-Path -LiteralPath $SnapshotPath -PathType Leaf)) {
    throw "Snapshot not found: $SnapshotPath"
}

$allowedRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE "WSL"))
$resolvedInstall = [IO.Path]::GetFullPath($InstallPath)
if (-not $resolvedInstall.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar)) {
    throw "InstallPath must remain inside $allowedRoot"
}

$installed = @(& wsl.exe --list --quiet) -replace [char]0, ""
if ($installed -contains $distro) {
    & wsl.exe --terminate $distro
    & wsl.exe --unregister $distro
    if ($LASTEXITCODE -ne 0) { throw "Failed to unregister $distro" }
}

if (Test-Path -LiteralPath $resolvedInstall) {
    Remove-Item -LiteralPath $resolvedInstall -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedInstall | Out-Null

& wsl.exe --import $distro $resolvedInstall $SnapshotPath --version 2
if ($LASTEXITCODE -ne 0) { throw "Failed to import $distro" }

& wsl.exe -d $distro -u root -- true
Write-Host "$distro restored from $SnapshotPath"
Write-Host "Run .\Verify-IntrospectionKernel.ps1 after services finish loading."

