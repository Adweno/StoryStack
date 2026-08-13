$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $repoRoot "mobile\story_stack_mobile"
$apkPath = Join-Path $mobileRoot "build\app\outputs\flutter-apk\app-debug.apk"
$flutter = if ($env:FLUTTER_BIN) { $env:FLUTTER_BIN } else { "flutter" }

if (-not (Test-Path $flutter) -and -not (Get-Command $flutter -ErrorAction SilentlyContinue)) {
  throw "Flutter was not found. Install Flutter or set FLUTTER_BIN to the Flutter executable path."
}

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
