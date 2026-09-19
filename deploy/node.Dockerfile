# TDAI supports Node 22; MemoryProxy enforces that major at startup.
FROM docker.io/library/node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS base
COPY deploy/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini git curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --create-home app && mkdir /data && chown app:app /data
WORKDIR /app
ENV NODE_ENV=production

FROM base AS builder
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# The upstream Dockerfiles use npm 11 with Node 22.
RUN npm install -g npm@11 --no-audit --no-fund
ENV NODE_ENV=development

FROM builder AS core-build
COPY .cache/upstream/tencent/MemoryCore/ ./
# Core ships no npm lock. Keep its manifest intact, including optional packages.
RUN npm install --package-lock=false --omit=dev --legacy-peer-deps --no-audit --no-fund

FROM base AS core
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=core-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
USER 10001:10001
ENV TDAI_GATEWAY_CONFIG=/config/core.yaml
EXPOSE 8420
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "tsx", "src/gateway/server.ts"]

FROM builder AS knowledge-build
COPY .cache/upstream/tencent/MemoryKnowledge/ ./
# Knowledge also ships no npm lock; dependency ranges remain upstream-owned.
RUN npm install --package-lock=false --no-audit --no-fund
RUN npm run build && npm prune --omit=dev --package-lock=false --no-audit --no-fund

FROM base AS knowledge
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=knowledge-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
USER 10001:10001
EXPOSE 8421
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/server.mjs"]

FROM builder AS panel-web-build
COPY .cache/upstream/tencent/MemoryPanel/web/ ./
RUN npm ci --no-audit --no-fund
RUN npm run build

FROM builder AS panel-build
COPY .cache/upstream/tencent/MemoryPanel/ ./
RUN npm ci --no-audit --no-fund
RUN npm run build
COPY --from=panel-web-build /app/dist ./web/dist

FROM base AS panel
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=panel-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
USER 10001:10001
EXPOSE 8123
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/index.js"]

FROM builder AS proxy-build
COPY .cache/upstream/tencent/MemoryProxy/ ./
RUN npm ci --no-audit --no-fund

FROM base AS memory-proxy
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=proxy-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
USER 10001:10001
EXPOSE 8096
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "tsx/esm", "src/index.ts"]
CMD ["--config", "/config/proxy.yaml"]

# AMS owns the HTTP boundary; the stdio implementation and its dependencies are
# the unchanged artifacts from this revision's ordinary Knowledge build.
FROM base AS mcp
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY deploy/locks/mcp/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY deploy/locks/mcp/bind-loopback.mjs /tmp/bind-loopback.mjs
RUN node /tmp/bind-loopback.mjs && rm /tmp/bind-loopback.mjs
COPY --from=knowledge-build /app /opt/knowledge
COPY .cache/upstream/tencent/LICENSE /opt/knowledge/LICENSE
COPY dist/runtime/ ./runtime/
COPY dist/config/ ./config/
COPY dist/deployment/ ./deployment/
USER 10001:10001
EXPOSE 8425
ENTRYPOINT ["/usr/bin/tini", "--", "node"]
CMD ["/app/runtime/mcp-gateway.js", "/config/mcp.json"]
