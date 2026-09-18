FROM docker.io/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
COPY deploy/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY deploy/locks/mcp/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY deploy/locks/mcp/bind-loopback.mjs /tmp/bind-loopback.mjs
RUN node /tmp/bind-loopback.mjs && rm /tmp/bind-loopback.mjs
COPY dist/runtime/ ./runtime/
COPY dist/config/ ./config/
COPY dist/deployment/ ./deployment/
USER 10001:10001
EXPOSE 8425
ENTRYPOINT ["/usr/bin/tini", "--", "node"]
CMD ["/app/runtime/mcp-gateway.js", "/config/mcp.json"]
