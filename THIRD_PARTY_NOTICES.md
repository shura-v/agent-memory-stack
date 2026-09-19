# Upstream software

The build downloads the source revisions and verifies the archive SHA-256 values
in the packaged `upstream.lock.json`. `ams update tdai` overrides the TDAI source for one installation through its `.ams/tdai-source.json`; the archive checksum is verified by the same build path. No Git checkout is used by the build or runtime.

| Component | Source | License |
| --- | --- | --- |
| MemoryCore, MemoryKnowledge, MemoryPanel, MemoryProxy | [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | MIT; upstream license copied to `/app/LICENSE` in each image |
| CLIProxyAPI | [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | MIT; copied to `/app/LICENSE` in its image |
| Supergateway 3.4.3 | [supercorp-ai/supergateway](https://github.com/supercorp-ai/supergateway) | MIT; retained in `/app/node_modules/supergateway` |
| MCP TypeScript SDK 1.30.0 | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT; retained in `/app/node_modules/@modelcontextprotocol/sdk` |

Node.js, Go and Debian images are pinned by multi-platform manifest digest.
Debian packages added by these Dockerfiles use the dated snapshot in
`deploy/debian.sources`. This pins dependency inputs; it does not promise
bit-for-bit identical image layers across builders.

## Dependency ownership

TDAI source files, manifests and supplied locks come unchanged from the selected verified archive. Panel, Panel web and Proxy use their upstream npm locks. Core and Knowledge currently have no npm lock and install their upstream dependency ranges; AMS does not provide substitutes. A fresh rebuild can therefore resolve different dependency versions. TDAI uses the pinned Node 22 base and npm 11; AMS tooling/runtime uses Node 24.

Ordinary installation and build scripts produce dependency and compiler outputs. AMS does not rewrite TDAI manifests or add application patches/preloads. Each image retains upstream licenses. CLIProxyAPI uses upstream `go.mod`/`go.sum`. AMS's own MCP transport dependencies retain their integrity-pinned lock in `deploy/locks/mcp`.

The MCP image contains the unchanged Knowledge build artifact and its dependencies under `/opt/knowledge`, including `/opt/knowledge/LICENSE`. Native configuration templates are extracted from source into the operator's flat defaults directory; they are not vendored in the npm package.

## Local image delivery

The MCP image uses its separate integrity-pinned npm lock in `deploy/locks/mcp`.
Its build changes Supergateway's stateful listener to bind container loopback:
the pinned version has no listen-host option. The worker command uses POSIX `exec` to run stock TDAI stdio MCP, so session expiry signals the actual child instead of an intermediate shell.
The loopback replacement requires one exact match and fails the build if the upstream
implementation changes. Only the AMS boundary
is reachable over Compose; it authenticates callers before routing to workers.
Review this patch when updating Supergateway.

After compiling the npm package, use `node dist/build/cli.js --runtime podman
--platform linux/arm64 --project-dir /path/to/build` (use `docker` and the target
platform as appropriate). Installed package resources are read-only inputs;
source cache and build context live under the selected directory's `.ams-build`.
The resulting `.ams/images.json` and `.ams/images.env` record content IDs and
platforms. Partial builds preserve a compatible image set; mixed platforms fail.

`--export /path/to/new-bundle` saves all seven images by content ID, source metadata and the verified `tdai-source.tar.gz` needed for offline defaults extraction. `--load /path/to/bundle` validates checksums, source templates, image revision labels, archive configuration IDs and native engine platform before loading. It verifies installed identities and stages pending source/image metadata; Apply activates the coherent configuration. Loading does not delete existing images. The npm package and image/source bundle are separate artifacts; the destination needs no checkout or compiler.
