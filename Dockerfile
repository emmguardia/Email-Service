# Multi-stage build:
#   - builder: full Debian + npm to install prod deps
#   - runtime: distroless (no npm, no apt, no shell) → 0 npm-related CVE
# Net result: scan Trivy clean by construction, smaller image, fewer attack surfaces.

# ---- Builder ----
FROM node:20-slim AS builder

ENV NPM_CONFIG_LOGLEVEL=error \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# ---- Runtime ----
# distroless/nodejs20: contient uniquement Node.js + ca-certs + tzdata.
# Pas de npm, pas de bash, pas d'apt → aucune CVE de tooling.
FROM gcr.io/distroless/nodejs20-debian12:nonroot

ENV NODE_ENV=production \
    TZ=Europe/Paris

WORKDIR /app

# chown 1000:1000 pour matcher securityContext.runAsUser de la chart Helm.
COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --chown=1000:1000 package.json ./
COPY --chown=1000:1000 src/ ./src/
COPY --chown=1000:1000 templates/ ./templates/

# distroless `nonroot` est uid 65532. La chart override avec runAsUser: 1000.
# Les fichiers étant chownés 1000:1000 ET en mode 644 par défaut, les deux fonctionnent.
USER 1000

EXPOSE 8080

# ENTRYPOINT distroless = ["/usr/bin/node"], donc CMD = arg du script.
# Pas de HEALTHCHECK Docker : kubelet pilote livenessProbe/readinessProbe (chart).
CMD ["src/server.js"]
