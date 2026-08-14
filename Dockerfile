# Multi-stage build:
#   - builder: full Debian + pnpm to install prod deps
#   - runtime: Chainguard distroless Node, rebuilt DAILY with latest CVE patches
# Net result: scan Trivy clean, minimal attack surface, no npm/apt/shell.
#
# Le runtime n'a pas été touché : Chainguard distroless est déjà le socle le
# plus dur possible ici (ni npm, ni apt, ni shell), et son tag `latest` est
# volontaire — l'image est reconstruite quotidiennement avec les correctifs CVE.
# L'épingler la figerait et supprimerait précisément ce bénéfice.
#
# Seul le builder change : npm -> pnpm et Node 20 -> 26.

# ---- Builder ----
FROM node:26-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /app

# pnpm épinglé. Pas de corepack : il a été retiré du bundle Node à partir de
# Node 25/26.
RUN npm install -g pnpm@10.33.4 --no-audit --no-fund

# .npmrc porte minimum-release-age=1440 et ignore-scripts=true : aucun script
# post-install de dépendance ne s'exécute pendant le build de l'image. Aucune
# dépendance de ce service n'étant native, rien n'a besoin d'être autorisé via
# pnpm.onlyBuiltDependencies.
COPY package.json pnpm-lock.yaml .npmrc ./

RUN pnpm install --prod --frozen-lockfile && \
    pnpm store prune 2>/dev/null || true

# ---- Runtime ----
# cgr.dev/chainguard/node:latest = distroless + rebuilds quotidiens.
# Pas de npm, pas d'apt, pas de shell. CVE OS patchées sous 24h.
# Public, pull anonyme (pas de signup Chainguard requis pour l'image free tier).
FROM cgr.dev/chainguard/node:latest

ENV NODE_ENV=production \
    TZ=Europe/Paris

WORKDIR /app

# UID/GID 1000 pour matcher securityContext.runAsUser de la chart Helm.
# Chainguard supporte USER numérique sans entrée /etc/passwd préalable.
COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --chown=1000:1000 package.json ./
COPY --chown=1000:1000 src/ ./src/
COPY --chown=1000:1000 templates/ ./templates/

USER 1000

EXPOSE 8080

# ENTRYPOINT Chainguard node = ["/usr/bin/node"]. CMD = arg du script.
# Pas de HEALTHCHECK Docker — kubelet pilote livenessProbe/readinessProbe (chart).
CMD ["src/server.js"]
