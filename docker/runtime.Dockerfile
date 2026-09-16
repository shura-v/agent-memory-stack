FROM docker.io/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /app
COPY dist/runtime/ ./runtime/
COPY dist/config/ ./config/
COPY dist/deployment/ ./deployment/
COPY package.json ./package.json
USER 10001:10001
ENTRYPOINT ["node"]
