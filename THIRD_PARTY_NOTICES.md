# Upstream software

The build downloads the source revisions and verifies the archive SHA-256 values
in the packaged `vendor/upstream.lock.json`. `ams update tdai` overrides the TDAI source for one installation through its `.ams/tdai-source.json`; the archive checksum is verified by the same build path. No Git checkout is used by the build or runtime.

| Component | Source | License |
| --- | --- | --- |
| MemoryCore, MemoryKnowledge, MemoryPanel, MemoryProxy | [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | MIT; upstream license copied to `/app/LICENSE` in each image |
| CLIProxyAPI | [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | MIT; copied to `/app/LICENSE` in its image |
| MCP TypeScript SDK 1.30.0 | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT; retained in `/app/node_modules/@modelcontextprotocol/sdk` |

Node.js, Go and Debian images are pinned by multi-platform manifest digest.
Debian packages added by these Dockerfiles use the dated snapshot in
`deploy/debian.sources`. This pins dependency inputs; it does not promise
bit-for-bit identical image layers across builders.

## Dependency ownership

TDAI source files, manifests and supplied locks come unchanged from the selected verified archive. Panel, Panel web and Proxy use their upstream npm locks. Core and Knowledge currently have no npm lock and install their upstream dependency ranges; AMS does not provide substitutes. A fresh rebuild can therefore resolve different dependency versions. The four TDAI application images use the pinned Node 22 base and build with npm 11; AMS tooling, support runtime and MCP image use Node 24.

Ordinary installation and build scripts produce dependency and compiler outputs. AMS does not rewrite TDAI manifests or add application patches/preloads. Each image retains upstream licenses. CLIProxyAPI uses upstream `go.mod`/`go.sum`. AMS and its MCP transport share the root `package.json` and integrity-pinned `package-lock.json`.

The MCP image contains the unchanged Knowledge build artifact and its dependencies under `/opt/knowledge`, including `/opt/knowledge/LICENSE`. Native configuration templates are extracted from source into the operator's flat defaults directory; they are not vendored in the npm package.

## Local image delivery

The MCP image uses Node 24 and installs the root production dependencies with
`npm ci --omit=dev --ignore-scripts`. The root `package-lock.json` is the single
tracked AMS lock. Build copies it to the packaged `dist/build/package-lock.json`
resource so installed AMS packages can supply the same lock to container builds.
The published CLI has no npm shrinkwrap.
The AMS gateway connects the SDK's standard HTTP and stdio transports directly.
The SDK launches the unchanged TDAI MCP artifact without a shell or intermediate
HTTP server. Only the authenticated AMS endpoint listens on the container network.
No dependency source patch or preload is applied.

After compiling the npm package, use `node dist/build/cli.js --runtime podman
--platform linux/arm64 --project-dir /path/to/build` (use `docker` and the target
platform as appropriate). Installed package resources are read-only inputs;
source cache and build context live under the selected directory's `.ams-build`.
The resulting `.ams/images.json` and `.ams/images.env` record content IDs and
platforms. Partial builds preserve a compatible image set; mixed platforms fail.

`--export /path/to/new-bundle` saves all seven images by content ID, source metadata and the verified `tdai-source.tar.gz` needed for offline defaults extraction. `--load /path/to/bundle` validates checksums, source templates, image revision labels, archive configuration IDs and native engine platform before loading. It verifies installed identities and stages pending source/image metadata; Apply activates the coherent configuration. Loading does not delete existing images. The npm package and image/source bundle are separate artifacts; the destination needs no checkout or compiler.
