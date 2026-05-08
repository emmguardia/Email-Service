FROM node:20-slim

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=error \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    DEBIAN_FRONTEND=noninteractive

RUN groupadd -r appuser 2>/dev/null || true && \
    useradd -r -g appuser -u 1000 appuser 2>/dev/null || true

WORKDIR /app

RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY src/ ./src/
COPY templates/ ./templates/

RUN mkdir -p /app/secrets && \
    chown -R 1000:1000 /app

USER 1000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "const http=require('http');http.get('http://localhost:8080/health/live',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
