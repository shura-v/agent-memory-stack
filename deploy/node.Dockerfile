FROM docker.io/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS base
COPY deploy/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini git && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --create-home app && mkdir /data && chown app:app /data
WORKDIR /app
ENV NODE_ENV=production

FROM base AS builder
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# Native addons compile against this image's Node ABI; optional platform packages
# (esbuild, jieba, sqlite-vec) remain installed from integrity-pinned npm tarballs.
ENV NODE_ENV=development npm_config_build_from_source=true npm_config_strict_allow_scripts=true

FROM builder AS core-build
COPY deploy/locks/core/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund
RUN node --import tsx -e "const {DatabaseSync}=await import('node:sqlite'); const vec=await import('sqlite-vec'); const db=new DatabaseSync(':memory:',{allowExtension:true}); vec.load(db); db.prepare('select vec_version()').get(); db.close(); await import('@node-rs/jieba')"
COPY .cache/upstream/tencent/MemoryCore/ ./
COPY deploy/locks/core/package*.json ./

FROM base AS core
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=core-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
COPY dist/runtime/environment.js /runtime/environment.mjs
USER 10001:10001
ENV TDAI_GATEWAY_CONFIG=/config/core.yaml TDAI_GATEWAY_HOST=0.0.0.0 TDAI_DATA_DIR=/data AMS_ENV_FILE=/config/core-env.json
EXPOSE 8420
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "/runtime/environment.mjs", "--import", "tsx", "src/gateway/server.ts"]

FROM builder AS knowledge-build
COPY deploy/locks/knowledge/package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY dist/build/native-smoke.js /tmp/native-smoke.mjs
COPY .cache/upstream/tencent/MemoryKnowledge/ ./
COPY deploy/locks/knowledge/package*.json ./
RUN npm run build && npm prune --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund
RUN node /tmp/native-smoke.mjs knowledge

FROM base AS knowledge
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=knowledge-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
COPY dist/runtime/environment.js /runtime/environment.mjs
USER 10001:10001
ENV KNOWLEDGE_DATA_DIR=/data KNOWLEDGE_DB_PATH=/data/knowledge.db PORT=8421 AMS_ENV_FILE=/config/knowledge-env.json
EXPOSE 8421
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "/runtime/environment.mjs", "dist/server.mjs"]

FROM builder AS panel-web-build
COPY deploy/locks/panel-web/package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY .cache/upstream/tencent/MemoryPanel/web/ ./
COPY deploy/locks/panel-web/package*.json ./
RUN npm run build

FROM builder AS panel-build
COPY deploy/locks/panel/package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY .cache/upstream/tencent/MemoryPanel/ ./
COPY deploy/locks/panel/package*.json ./
RUN npm run build && npm prune --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund
# Panel uses tsc with allowJs=false: preserve the shared ESM helper explicitly.
RUN node --input-type=module -e "import {copyFileSync} from 'node:fs'; copyFileSync('src/ams-integration.js', 'dist/ams-integration.js'); const {buildPanelApp}=await import('./dist/panel/http/app.js'); if(typeof buildPanelApp!=='function') throw new Error('Panel entry module unavailable')"
COPY --from=panel-web-build /app/dist ./web/dist

FROM base AS panel
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=panel-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
COPY dist/runtime/environment.js /runtime/environment.mjs
USER 10001:10001
ENV PANEL_PORT=8123 METADATA_INSTANCES_CONFIG=/config/panel-instances.json KNOWLEDGE_LLM_BINDING_SYNC=false AMS_ENV_FILE=/config/panel-env.json
EXPOSE 8123
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "/runtime/environment.mjs", "dist/index.js"]

FROM builder AS proxy-build
COPY deploy/locks/proxy/package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY dist/build/native-smoke.js /tmp/native-smoke.mjs
RUN node /tmp/native-smoke.mjs proxy
COPY .cache/upstream/tencent/MemoryProxy/ ./
COPY deploy/locks/proxy/package*.json ./

FROM base AS memory-proxy
ARG TDAI_REVISION
LABEL org.opencontainers.image.source="https://github.com/TencentCloud/TencentDB-Agent-Memory" org.opencontainers.image.revision="${TDAI_REVISION}"
COPY --from=proxy-build --chown=10001:10001 /app /app
COPY .cache/upstream/tencent/LICENSE /app/LICENSE
COPY dist/runtime/environment.js /runtime/environment.mjs
USER 10001:10001
ENV PROXY_DB_PATH=/data/proxy.db AMS_ENV_FILE=/config/proxy-env.json
EXPOSE 8096
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "/runtime/environment.mjs", "--import", "tsx/esm", "src/index.ts"]
CMD ["--config", "/config/proxy.yaml"]
