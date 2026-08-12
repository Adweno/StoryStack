$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $repoRoot "mobile\story_stack_mobile"
$apkPath = Join-Path $mobileRoot "build\app\outputs\flutter-apk\app-debug.apk"
$preferredFlutter = "C:\Users\adamw\.puro\envs\stable\flutter\bin\flutter.bat"
$flutter = if (Test-Path $preferredFlutter) { $preferredFlutter } else { "flutter" }

Push-Location $mobileRoot
try {
  & $flutter build apk --debug

  $devices = adb devices |
    Select-String "`tdevice$" |
    ForEach-Object { ($_ -split "`t")[0] } |
    Where-Object { $_ -notlike "adb-*" }

  if (-not $devices) {
    throw "No USB Android device found. Plug in the phone with USB debugging enabled."
  }

  $device = @($devices)[0]
  adb -s $device install -r $apkPath
  Write-Host "Installed Story Stack on $device"
}
finally {
  Pop-Location
}
