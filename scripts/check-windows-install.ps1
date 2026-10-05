# Installs a built WE Budget installer the way a user would, with Microsoft
# Defender protection switched on as on a home computer, and checks what a
# user would notice:
#   - Defender has nothing to report about the installer or the installed app;
#   - the app is installed for the current user only, so no administrator
#     rights are needed;
#   - the app starts and keeps running;
#   - an update over the installed copy, run with the flags the app itself
#     uses, succeeds;
#   - uninstalling removes the app and keeps the user's data.
#
# Meant for a throwaway machine such as a CI runner: it changes Defender
# settings and installs and removes the app for the current user.
#
#   pwsh scripts/check-windows-install.ps1 [-Installer <path to WE-Budget-x.y.z-win-x64.exe>] [-ExpectGoogleClient] [-Repeat <n>]

param(
  [string]$Installer,
  # Release builds must carry the Google sign-in client; CI builds do not.
  [switch]$ExpectGoogleClient,
  # Install and uninstall this many times first, to catch an installer that
  # fails only now and then.
  [int]$Repeat = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$AppName = 'WE Budget'
$ProcessName = 'WE Budget'
$ExeName = 'WE Budget.exe'
$Publisher = 'White Eagles & Co. s.r.o.'
$UninstallRoot = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
$StartedAt = Get-Date
$script:Warnings = 0

function Step([string]$Text) { Write-Host ''; Write-Host "== $Text" }
function Fail([string]$Text) { Write-Host "::error::$Text"; exit 1 }
function Warn([string]$Text) { Write-Host "::warning::$Text"; $script:Warnings++ }

function Find-UninstallEntry([string]$Hive) {
  $root = "${Hive}:\$UninstallRoot"
  if (-not (Test-Path $root)) { return $null }
  Get-ChildItem $root | ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like "$AppName *" } | Select-Object -First 1
}

function Stop-App {
  Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
  for ($i = 0; $i -lt 30 -and (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Milliseconds 500
  }
  Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force
}

function Wait-App([int]$Seconds) {
  for ($i = 0; $i -lt $Seconds * 2; $i++) {
    if (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Detections made since this script started, with the threat names. With
# protection back on, Defender may also flag tools of the CI image itself;
# only detections that touch this app's files fail the check.
$script:Reported = @{}
function Get-NewDetections {
  @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { $_.InitialDetectionTime -ge $StartedAt }) |
    ForEach-Object {
      $threat = Get-MpThreat -ThreatID $_.ThreatID -ErrorAction SilentlyContinue | Select-Object -First 1
      $resources = ($_.Resources -join '; ')
      [pscustomobject]@{
        Key = "$($_.DetectionID)"
        Threat = if ($threat) { $threat.ThreatName } else { "ID $($_.ThreatID)" }
        Resources = $resources
        Ours = $resources -match 'WE[ -]Budget|we-budget'
      }
    }
}

function Assert-NoDetections([string]$Stage) {
  $found = @(Get-NewDetections)
  $ours = @($found | Where-Object { $_.Ours })
  $found | Where-Object { -not $_.Ours -and -not $script:Reported.ContainsKey($_.Key) } | ForEach-Object {
    $script:Reported[$_.Key] = $true
    Warn "Defender flagged something outside this app: $($_.Threat) in $($_.Resources)"
  }
  if ($ours.Count) {
    $ours | Format-List Threat, Resources | Out-String | Write-Host
    Fail "Microsoft Defender reported $($ours.Count) detection(s) in WE Budget files $Stage"
  }
}

function Scan([string]$Path) {
  try {
    Start-MpScan -ScanType CustomScan -ScanPath $Path
  } catch {
    Warn "Defender could not scan $Path`: $($_.Exception.Message)"
    return
  }
  Assert-NoDetections "while scanning $Path"
  Write-Host "Defender found nothing in $Path"
}

# What Windows and Defender logged since the script started, to tell why an
# installer or uninstaller failed: the crashed module, a blocked file.
function Show-Crash([string]$What) {
  Write-Host "What Windows logged around the failed $What`:"
  try {
    Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001, 1002; StartTime = $StartedAt } -ErrorAction Stop |
      Select-Object -First 6 | ForEach-Object { Write-Host "[$($_.TimeCreated)] $($_.ProviderName) $($_.Id)"; Write-Host $_.Message }
  } catch { Write-Host 'No application errors in the event log.' }
  try {
    Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; StartTime = $StartedAt } -ErrorAction Stop |
      Where-Object { $_.Id -in 1006, 1007, 1008, 1015, 1116, 1117, 1118, 1119, 1121, 1122, 1123, 1124, 1125, 1126, 1127, 1128 } |
      Select-Object -First 10 | ForEach-Object { Write-Host "[$($_.TimeCreated)] Defender $($_.Id)"; Write-Host $_.Message }
  } catch { Write-Host 'No Defender detections or blocks in the event log.' }
  Get-NewDetections | Format-List Threat, Resources | Out-String | Write-Host
  Get-ChildItem -Path $env:TEMP -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue | ForEach-Object {
    $files = @(Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object Name)
    Write-Host "Left in $($_.FullName): $($files -join ', ')"
  }
}

if (-not $Installer) {
  $found = Get-ChildItem -Path 'release.nosync' -Filter 'WE-Budget-*-win-x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $Installer = $found.FullName }
}
if (-not $Installer -or -not (Test-Path $Installer)) { Fail 'No installer found in release.nosync' }
$Installer = (Resolve-Path $Installer).Path
Write-Host "Installer: $Installer"

Step 'Microsoft Defender with the protection of a home computer'
# CI images come with Defender switched off and whole drives excluded.
foreach ($path in @((Get-MpPreference).ExclusionPath)) {
  if ($path) { Remove-MpPreference -ExclusionPath $path }
}
$settings = [ordered]@{
  DisableRealtimeMonitoring = $false
  DisableBehaviorMonitoring = $false
  DisableIOAVProtection = $false
  DisableScriptScanning = $false
  DisableArchiveScanning = $false
  MAPSReporting = 'Advanced'
  SubmitSamplesConsent = 'SendSafeSamples'
  DisableBlockAtFirstSeen = $false
  PUAProtection = 'Enabled'
}
foreach ($name in $settings.Keys) {
  $params = @{ $name = $settings[$name] }
  try { Set-MpPreference @params } catch { Warn "Defender setting $name was not applied: $($_.Exception.Message)" }
}
# Group Policy values outrank the preferences above.
$policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender'
if (Test-Path $policy) {
  Write-Host 'Defender policy on this machine:'
  Get-Item $policy | Out-String | Write-Host
  Get-ChildItem $policy -Recurse | Out-String | Write-Host
  foreach ($name in 'DisableAntiSpyware', 'DisableRealtimeMonitoring', 'DisableAntiVirus') {
    Remove-ItemProperty -Path $policy -Name $name -ErrorAction SilentlyContinue
  }
  foreach ($key in 'Real-Time Protection', 'Spynet', 'Exclusions') {
    Remove-Item -Path (Join-Path $policy $key) -Recurse -Force -ErrorAction SilentlyContinue
  }
}
try { Update-MpSignature } catch { Warn "Defender signatures were not updated: $($_.Exception.Message)" }
Start-Sleep -Seconds 10
Get-MpPreference | Format-List DisableRealtimeMonitoring, DisableBehaviorMonitoring, DisableIOAVProtection, MAPSReporting,
  SubmitSamplesConsent, DisableBlockAtFirstSeen, PUAProtection, ExclusionPath | Out-String | Write-Host
$status = Get-MpComputerStatus
$status | Format-List AMRunningMode, AntivirusEnabled, RealTimeProtectionEnabled, BehaviorMonitorEnabled, IoavProtectionEnabled,
  AntivirusSignatureVersion, AntivirusSignatureLastUpdated | Out-String | Write-Host
$MpCmdRun = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
$maps = (& $MpCmdRun -ValidateMapsConnection 2>&1 | Out-String).Trim()
Write-Host "Cloud protection: $maps"
if ($LASTEXITCODE -ne 0) { Warn 'Defender cannot reach its cloud protection; scans use local signatures only' }
if (-not $status.RealTimeProtectionEnabled) {
  Warn 'Real-time protection is off on this machine; only the scans below check the files'
}

Step 'Scan the installer'
Scan $Installer

if ($Repeat -gt 0) {
  Step "Install and uninstall $Repeat times in a row"
  $failed = 0
  for ($n = 1; $n -le $Repeat; $n++) {
    $run = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
    if ($run.ExitCode -ne 0) {
      $failed++
      Write-Host "Install $n of $Repeat exited with code $($run.ExitCode)"
      Show-Crash "install $n"
    }
    $placed = Find-UninstallEntry 'HKCU'
    if ($placed) {
      $remover = ([regex]::Match($placed.UninstallString, '^"([^"]+)"')).Groups[1].Value
      $exe = Join-Path (Split-Path $remover -Parent) $ExeName
      $run = Start-Process -FilePath $remover -ArgumentList '/currentuser', '/S' -PassThru -Wait
      if ($run.ExitCode -ne 0) {
        $failed++
        Write-Host "Uninstall $n of $Repeat exited with code $($run.ExitCode)"
        Show-Crash "uninstall $n"
      }
      for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Milliseconds 500 }
    }
  }
  if ($failed) { Fail "$failed of $Repeat install and uninstall rounds failed" }
  Write-Host "All $Repeat rounds went through"
}

Step 'Install silently'
$run = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
if ($run.ExitCode -ne 0) { Show-Crash 'installation'; Fail "The installer exited with code $($run.ExitCode)" }
Assert-NoDetections 'during installation'

$entry = Find-UninstallEntry 'HKCU'
if (-not $entry) { Fail 'No uninstall entry for the current user: the app was not installed per user' }
if (Find-UninstallEntry 'HKLM') { Fail 'An uninstall entry for all users exists: the installer needed administrator rights' }
if ($entry.Publisher -ne $Publisher) { Fail "Publisher in Apps and Features is '$($entry.Publisher)'" }
$uninstaller = ([regex]::Match($entry.UninstallString, '^"([^"]+)"')).Groups[1].Value
$installDir = Split-Path $uninstaller -Parent
$appExe = Join-Path $installDir $ExeName
Write-Host "Installed: $($entry.DisplayName) in $installDir"
if (-not $installDir.StartsWith($env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase)) {
  Fail "The app was installed outside the user's own folder: $installDir"
}
if (-not (Test-Path $appExe)) { Fail "$appExe is missing" }

$info = (Get-Item $appExe).VersionInfo
$info | Format-List CompanyName, FileDescription, ProductName, LegalCopyright, FileVersion, ProductVersion | Out-String | Write-Host
if ($info.CompanyName -ne $Publisher) { Fail "Company name in the app is '$($info.CompanyName)'" }
if ($info.ProductName -ne $AppName) { Fail "Product name in the app is '$($info.ProductName)'" }

foreach ($link in @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"))) {
  if (Test-Path $link) { Write-Host "Shortcut: $link" } else { Fail "Shortcut missing: $link" }
}

if ($ExpectGoogleClient) {
  $asar = Join-Path $installDir 'resources\app.asar'
  $listing = (& npx --yes @electron/asar list $asar 2>$null) -join "`n"
  if ($listing -notmatch 'oauth-credentials\.json') { Fail 'The installed app has no Google sign-in client (oauth-credentials.json)' }
  Write-Host 'Google sign-in client: bundled'
}

Step 'Scan the installed app'
Scan $installDir

Step 'Start the app and let it run'
$app = Start-Process -FilePath $appExe -PassThru
Start-Sleep -Seconds 20
if ($app.HasExited) { Fail "The app quit by itself with exit code $($app.ExitCode)" }
$window = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($window) { Write-Host "Running, window title: $($window.MainWindowTitle)" } else { Write-Host 'Running (no visible desktop on this machine)' }
if (-not (Test-Path (Join-Path $env:APPDATA $AppName))) { Fail 'The app did not create its data folder' }
Assert-NoDetections 'while the app was running'
Stop-App

Step 'Update over the installed copy with the flags the app uses'
$run = Start-Process -FilePath $Installer -ArgumentList '--updated', '/S', '--force-run' -PassThru -Wait
if ($run.ExitCode -ne 0) { Show-Crash 'update'; Fail "The update exited with code $($run.ExitCode)" }
$after = Find-UninstallEntry 'HKCU'
if (-not $after -or $after.UninstallString -ne $entry.UninstallString) { Fail 'The update did not go into the installed copy' }
if (-not (Test-Path $appExe)) { Fail "$appExe is missing after the update" }
if (Wait-App 15) {
  Write-Host 'The app started again after the update'
} else {
  # The installer starts the app through the desktop shell, which a CI
  # session may not have.
  Warn 'The app did not start again after the update'
}
Assert-NoDetections 'during the update'
Stop-App

Step 'Uninstall silently'
$run = Start-Process -FilePath $uninstaller -ArgumentList '/currentuser', '/S' -PassThru -Wait
if ($run.ExitCode -ne 0) { Show-Crash 'uninstallation'; Fail "The uninstaller exited with code $($run.ExitCode)" }
# The uninstaller copies itself to a temporary folder and finishes from there.
for ($i = 0; $i -lt 60 -and (Test-Path $appExe); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path $appExe) { Fail 'The app is still installed after uninstalling' }
if (Find-UninstallEntry 'HKCU') { Fail 'The uninstall entry is still there' }
if (-not (Test-Path (Join-Path $env:APPDATA $AppName))) { Fail "Uninstalling removed the user's data folder" }
Write-Host 'Removed; the data folder is kept'

Step 'Result'
Assert-NoDetections 'during the run'
Write-Host 'Microsoft Defender reported nothing.'
if ($script:Warnings) { Write-Host "$($script:Warnings) warning(s), see above." }
