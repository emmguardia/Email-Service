# Security Policy

## Reporting a Vulnerability

Si tu identifies une vulnérabilité dans ce service, merci de **ne pas ouvrir une issue publique**.

Contacte directement le mainteneur via une issue privée GitHub Security Advisory ou par email.

Tu recevras un accusé de réception sous 48h. Les vulnérabilités sont traitées par ordre de gravité (CVSS) ; un correctif est publié dès que possible et un avis GHSA est émis pour les CVEs.

## Scope

Ce service traite des emails sortants pour 3 projets (laurence, enzo, clos-de-la-reine) et stocke des secrets sensibles (Gmail app passwords, JWT keys). Sont particulièrement critiques :

- Authentification JWT (RS256)
- Gestion des secrets via SealedSecrets
- Templates Handlebars (XSS)
- Validation des entrées (Joi) — notamment attachments
- Rate-limit Redis (anti-abus)

## Out of scope

- Vulnérabilités dans les dépendances déjà signalées par Dependabot/Trivy
- Vulnérabilités nécessitant un accès admin au cluster
- DoS via épuisement de quotas Gmail (mitigé par rate-limit)
