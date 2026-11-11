# Lance le site local (données complètes) et l'ouvre dans le navigateur.
# Usage : scripts\serve.ps1 [-NoSync] [-NoBrowser] [-Port 8137]
param(
    [switch]$NoSync,
    [switch]$NoBrowser,
    [int]$Port = 8137
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
# 127.0.0.1 plutôt que localhost, qui perd deux secondes à essayer IPv6
$url = "http://127.0.0.1:$Port/"

function Test-Port {
    try {
        $client = [Net.Sockets.TcpClient]::new('127.0.0.1', $Port)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

# Un second double-clic rouvre simplement la page du serveur déjà lancé
if (Test-Port) {
    Start-Process $url
    return
}

if (-not $NoSync) {
    Write-Host 'Synchro Notion...'
    python scripts/sync_notion.py
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Synchro impossible : le site affiche les dernières données connues.'
    }
}

$server = Start-Process python -ArgumentList 'scripts/serve.py', $Port -NoNewWindow -PassThru
try {
    foreach ($try in 1..50) {
        if (Test-Port) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $NoBrowser) { Start-Process $url }
    Write-Host "`nSite local : $url"
    Write-Host 'Ferme cette fenêtre (ou Ctrl+C) pour arrêter le serveur.'
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
