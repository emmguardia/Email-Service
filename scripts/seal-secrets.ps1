$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$SecretsPlain = Join-Path $RepoRoot "charts\email-service\secrets\email-service-secrets.yaml"
$SealedTemplate = Join-Path $RepoRoot "charts\email-service\templates\sealed-secret.yaml"
$Cert = if ($env:CERT) { $env:CERT } else { Join-Path (Split-Path $RepoRoot -Parent) "Clos-De-La-Reine-Argo-Repo\pub-cert.pem" }

if (-not (Test-Path $SecretsPlain)) {
  Write-Error ('Fichier non trouve : ' + $SecretsPlain)
  exit 1
}
if (-not (Test-Path $Cert)) {
  Write-Error ('Certificat non trouve : ' + $Cert)
  exit 1
}

Write-Host 'Chiffrement de email-service-secrets...'
$sealed = Get-Content $SecretsPlain -Raw | kubeseal --format yaml --cert $Cert --scope namespace-wide
if ($LASTEXITCODE -ne 0) {
  throw 'kubeseal a echoue.'
}

$sealed = $sealed -replace 'namespace: email-service', 'namespace: {{ include "email.namespace" . }}'
$sealed | Set-Content -Path $SealedTemplate -Encoding utf8

Write-Host 'OK - sealed-secret.yaml mis a jour.'
Write-Host ('Fichier plain (NE PAS COMMITTER) : ' + $SecretsPlain)
