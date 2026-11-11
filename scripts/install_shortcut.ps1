# Crée le raccourci « Réseau des lectures » sur le bureau et dans le menu Démarrer.
# Usage : scripts\install_shortcut.ps1
$script = Join-Path $PSScriptRoot 'serve.ps1'
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $shell) { $shell = (Get-Command powershell).Source }

$wsh = New-Object -ComObject WScript.Shell
foreach ($folder in 'Desktop', 'Programs') {
    $path = Join-Path ([Environment]::GetFolderPath($folder)) 'Réseau des lectures.lnk'
    $link = $wsh.CreateShortcut($path)
    $link.TargetPath = $shell
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
    $link.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $link.IconLocation = "$env:SystemRoot\System32\imageres.dll,170"
    $link.Description = 'Synchronise Notion puis ouvre le réseau des lectures en local'
    $link.WindowStyle = 7
    $link.Save()
    Write-Host "Raccourci créé : $path"
}
