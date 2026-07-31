param(
  [string]$ServiceName = "StoryStack",
  [string]$DisplayName = "Story Stack",
  [string]$ProjectPath = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$Port = "4100",
  [string]$HostName = "0.0.0.0",
  [string]$LibraryPath = ""
)

$ErrorActionPreference = "Stop"

$nodePath = (Get-Command node).Source
$serviceScript = Join-Path $ProjectPath "scripts\windows-service-runner.cjs"
$envFile = Join-Path $ProjectPath ".env"

if (-not (Test-Path $envFile)) {
  @(
    "PORT=$Port"
    "HOST=$HostName"
    "STORY_STACK_DATA_DIR=./data"
    "STORY_STACK_LIBRARY_PATH=$LibraryPath"
  ) | Set-Content -LiteralPath $envFile -Encoding UTF8
}

New-Service `
  -Name $ServiceName `
  -DisplayName $DisplayName `
  -BinaryPathName "`"$nodePath`" `"$serviceScript`"" `
  -StartupType Automatic `
  -Description "Story Stack audiobook Store and personal library app."

Write-Host "Installed $DisplayName. Start it with: Start-Service $ServiceName"
