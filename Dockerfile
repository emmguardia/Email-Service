# Multi-stage build:
#   - builder: full Debian + npm to install prod deps
#   - runtime: Chainguard distroless Node, rebuilt DAILY with latest CVE patches
# Net result: scan Trivy clean, minimal attack surface, no npm/apt/shell.

# ---- Builder ----
FROM node:26-bookworm-slim AS builder

ENV NPM_CONFIG_LOGLEVEL=error \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

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
