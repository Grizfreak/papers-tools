# Change le lien secret : nouveau SITE_PATH puis redéploiement ; l'ancien lien cesse de marcher.
# Usage : scripts\new_link.ps1 [-Subdomain <sous-domaine workers.dev>] [-Name carte-these]
param(
    [string]$Subdomain,
    [string]$Name = 'carte-these'
)
$ErrorActionPreference = 'Stop'

# 18 octets aléatoires donnent 24 caractères parmi A-Z a-z 0-9 _ -
$path = python -c "import secrets; print(secrets.token_urlsafe(18))"
$path | gh secret set SITE_PATH
if ($LASTEXITCODE -ne 0) { throw 'gh secret set a échoué.' }
gh workflow run sync.yml
if ($LASTEXITCODE -ne 0) { throw 'gh workflow run a échoué.' }

$host_ = if ($Subdomain) { "$Name.$Subdomain.workers.dev" } else { "$Name.<sous-domaine>.workers.dev" }
Write-Host "`nNouvelle adresse (active à la fin du workflow, voir gh run watch) :"
Write-Host "https://$host_/$path/"
Write-Host 'Pense à remplacer le lien du bloc /embed dans Notion.'
