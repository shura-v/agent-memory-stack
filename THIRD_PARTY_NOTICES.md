# Upstream software

The build downloads the source revisions and verifies the archive SHA-256 values
in `upstream.lock.json`. No sibling checkout is used by the build or runtime.

| Component | Source | License |
| --- | --- | --- |
| MemoryCore, MemoryKnowledge, MemoryPanel, MemoryProxy | [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | MIT; upstream license copied to `/app/LICENSE` in each image |
| CLIProxyAPI | [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | MIT; copied to `/app/LICENSE` in its image |

Node.js, Go and Debian images are pinned by multi-platform manifest digest.
Debian packages added by these Dockerfiles use the dated snapshot in
`docker/debian.sources`. This pins dependency inputs; it does not promise
bit-for-bit identical image layers across builders.

## Dependency locks

`docker/locks/*/package-lock.json` records the npm dependency versions and integrity
checksums used by `npm ci`. The Panel, Panel web and Proxy locks derive from the
upstream locks; Core and Knowledge are resolved for this distribution. Proxy and
Knowledge pin `better-sqlite3` 13.0.3: its N-API implementation replaces the V8
cleanup path that caused intermittent process aborts with version 11.10.0 on our
pinned Node 24 image. The package's public SQLite API is checked during builds.
See the upstream [N-API migration](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
and [pinned release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3).
Core's
manifest removes optional OpenClaw/local-model peers, development dependencies,
and its host OpenClaw postinstall script. The server runs the gateway source with
the locked `tsx` package. Optional native platform dependencies are retained.

Lockfiles were synchronized using npm 11.6.2 with
`--package-lock-only --ignore-scripts --legacy-peer-deps`; builds use npm 11.19.0
bundled in the pinned Node image and `npm ci --legacy-peer-deps`. The manifests
allow install scripts for locked versions of esbuild, better-sqlite3 and node-pty;
unneeded protobufjs and macOS fsevents scripts are explicitly denied. Strict script
policy catches newly introduced scripts. Native installation runs inside the build
container with a compiler toolchain available; bundled platform binaries are
covered by npm package integrity hashes. Native loading, SQLite API behavior,
and repeated process teardown are checked before producing an image.
Third-party packages retain their own licenses in
`node_modules`; CLIProxyAPI dependencies are locked by upstream `go.mod`/`go.sum`
and verified before the build.

`dist/patches/apply.js` applies this distribution's narrowly scoped source changes to
a newly extracted source tree. Updating upstream revisions requires reviewing
the patches, dependency locks, image pins, and regression checks together.

## Local image delivery

After compiling the npm package, use `node dist/build/cli.js --runtime podman
--platform linux/arm64 --project-dir /path/to/build` (use `docker` and the target
platform as appropriate). Installed package resources are read-only inputs;
source cache and build context live under the selected directory's `.ams-build`.
The resulting `.ams/images.json` and `.ams/images.env` record content IDs and
platforms. Partial builds preserve a compatible image set; mixed platforms fail.

`--export /path/to/new-bundle` saves the manifest's images by content ID into a Docker
archive with archive and manifest SHA-256 checksums. `--load /path/to/bundle`
validates checksums, archive configuration IDs, and native engine platform before
loading, then verifies installed identities and writes the selected installation's
`.ams/images.json` and `.ams/images.env`. Loading does not delete existing images.
The npm package and this image bundle are separate delivery artifacts; the VPS
does not need the TencentDB sibling checkout or a compiler.
