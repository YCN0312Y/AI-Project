param(
  [switch]$Disable,
  [switch]$Preview
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$previewEntry = Join-Path $PSScriptRoot 'start-preview.cjs'
$startupFolder = [Environment]::GetFolderPath('Startup')
if (-not $startupFolder) { throw 'The current user Startup folder is unavailable.' }
$shortcutPath = Join-Path $startupFolder 'ZhiLinQianXian Preview.lnk'

if ($Disable) {
  if (-not $Preview -and (Test-Path -LiteralPath $shortcutPath)) {
    Remove-Item -LiteralPath $shortcutPath
  }
  Write-Output ('Autostart disabled: ' + $shortcutPath)
  exit 0
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeCandidates = @(
  $(if ($nodeCommand) { $nodeCommand.Source }),
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
)
$nodeExecutable = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $nodeExecutable) { throw 'Node.js was not found. Install Node.js, then enable autostart again.' }
if (-not (Test-Path -LiteralPath $previewEntry -PathType Leaf)) { throw 'The preview launcher is missing.' }

function Quote-PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

$powerShellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launchCommand = '& ' + (Quote-PowerShellLiteral $nodeExecutable) + ' ' + (Quote-PowerShellLiteral $previewEntry) + ' --no-open'
$launchArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $launchCommand + '"'
$plan = [pscustomobject]@{
  Shortcut = $shortcutPath
  Target = $powerShellExecutable
  Arguments = $launchArguments
  WorkingDirectory = $projectRoot
  Url = 'http://localhost:8136/'
}
if ($Preview) { $plan; exit 0 }

$shortcutShell = New-Object -ComObject WScript.Shell
$startupShortcut = $shortcutShell.CreateShortcut($shortcutPath)
$startupShortcut.TargetPath = $powerShellExecutable
$startupShortcut.Arguments = $launchArguments
$startupShortcut.WorkingDirectory = $projectRoot
$startupShortcut.WindowStyle = 7
$startupShortcut.Description = 'Start the local ZhiLinQianXian game preview after Windows sign-in.'
$startupShortcut.Save()
Write-Output 'Autostart enabled. The game service will start in the background after Windows sign-in.'
$plan
