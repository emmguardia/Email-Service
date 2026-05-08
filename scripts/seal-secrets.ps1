# Chiffre email-service-secrets.yaml avec kubeseal et met à jour
# charts/email-service/templates/sealed-secret.yaml.
# Le fichier plain reste local (gitignored), seul le SealedSecret est commité.
#
# Usage:
#   .\scripts\seal-secrets.ps1
# Variables d'environnement optionnelles:
#   $env:CERT = "C:\path\to\pub-cert.pem"   # défaut: ../Clos-De-La-Reine-Argo-Repo/pub-cert.pem
#
# Prérequis:
#   - kubeseal installé (https://github.com/bitnami-labs/sealed-secrets/releases)
#   - charts/email-service/secrets/email-service-secrets.yaml créé à partir du .example.yaml

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$SecretsPlain = Join-Path $RepoRoot "charts\email-service\secrets\email-service-secrets.yaml"
$SealedTemplate = Join-Path $RepoRoot "charts\email-service\templates\sealed-secret.yaml"
$Cert = if ($env:CERT) { $env:CERT } else { Join-Path (Split-Path $RepoRoot -Parent) "Clos-De-La-Reine-Argo-Repo\pub-cert.pem" }

if (-not (Test-Path $SecretsPlain)) {
  Write-Error "Fichier non trouvé : $SecretsPlain"
  Write-Host "Crée-le à partir du modèle :"
  Write-Host "  Copy-Item charts\email-service\secrets\email-service-secrets.example.yaml charts\email-service\secrets\email-service-secrets.yaml"
  exit 1
}
if (-not (Test-Path $Cert)) {
  Write-Error "Certificat non trouvé : $Cert"
  Write-Host "Définis `$env:CERT=chemin\vers\pub-cert.pem si besoin"
  exit 1
}

Write-Host "Chiffrement de email-service-secrets..."
$sealed = Get-Content $SecretsPlain -Raw | kubeseal --format yaml --cert $Cert --scope namespace-wide
if ($LASTEXITCODE -ne 0) {
  throw "kubeseal a échoué."
}

# Remplacer le namespace fixe par le template Helm
$sealed = $sealed -replace 'namespace: email-service', 'namespace: {{ include "email.namespace" . }}'
$sealed | Set-Content -Path $SealedTemplate -Encoding utf8

Write-Host "OK — sealed-secret.yaml mis à jour."
Write-Host "Fichier plain (NE PAS COMMITTER) : $SecretsPlain"
