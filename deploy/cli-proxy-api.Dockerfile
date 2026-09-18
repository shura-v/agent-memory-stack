FROM docker.io/library/golang:1.26-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81 AS build
WORKDIR /build
ENV GOTOOLCHAIN=local CGO_ENABLED=1
COPY .cache/upstream/cliproxy/go.mod .cache/upstream/cliproxy/go.sum ./
RUN go mod download && go mod verify
COPY .cache/upstream/cliproxy/ ./
RUN GOMAXPROCS=2 GOMEMLIMIT=512MiB go build -p 1 -mod=readonly -trimpath -buildvcs=false -ldflags="-s -w -X main.Version=ams-pinned -X main.Commit=7bbfeaf8a7acf2cd5a834dcb0842539fe6aabc2b -X main.BuildDate=2026-09-15" -o /out/cli-proxy-api ./cmd/server/

FROM docker.io/library/debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
COPY deploy/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata tini libstdc++6 && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --create-home app && mkdir -p /app /data/auth && chown -R app:app /app /data
COPY --from=build /out/cli-proxy-api /app/cli-proxy-api
COPY .cache/upstream/cliproxy/LICENSE /app/LICENSE
WORKDIR /app
USER 10001:10001
LABEL org.opencontainers.image.source="https://github.com/router-for-me/CLIProxyAPI" org.opencontainers.image.revision="7bbfeaf8a7acf2cd5a834dcb0842539fe6aabc2b"
EXPOSE 8317
ENTRYPOINT ["/usr/bin/tini", "--", "/app/cli-proxy-api"]
CMD ["-config", "/config/cli-proxy-api.yaml"]
