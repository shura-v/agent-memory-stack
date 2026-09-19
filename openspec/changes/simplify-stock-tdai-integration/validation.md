# Stock TDAI integration validation

Date: 2026-09-19. Isolated synthetic installations only; the operator's existing stack is outside these projects.

## Automated and installed-package checks

| Check | Result |
| --- | --- |
| Clean `npm test` | 413 passed, 9 opt-in skipped, 0 failed; `/private/tmp/ams-stock-suite-final.log` |
| TypeScript | `npm run typecheck` passed |
| OpenSpec | Strict change validation passed |
| Source/bundle/update checks | 41 source/bundle/update checks passed before the final offline-Configure correction; 90 combined source/update/setup/apply regressions passed after it. All are included in the final complete suite |
| Installed npm package | Configure acquired verified originals through a download fixture, without engine/images; five flat defaults; source pinned; repeated Apply used existing files without source fetch/model prompts; empty models and custom API prefix accepted; standalone check passed |
| Package contents | No TDAI patches, copied templates, TDAI dependency overlays, deleted compiled modules or installation secrets |

Final review found and fixed first Configure after a fresh offline import selecting the packaged revision instead of the imported revision. Regressions exercise actual Configure after import and preserve the active revision for existing installations with pending updates. The final installed-package test also saves a different imported source revision completely offline.

Package evidence: `/private/tmp/ams-stock-package-final/evidence.json`. Its download fixture returns the actual verified selected-source archive; runtime/image calls are stubbed in this package-only check. First Apply finalizes initially deferred public origins; preservation is checked after that normal initialization.

## Unmodified source and production images

TDAI revision `0468a2a5b50eaafc54758ed1e2e6609472e5b6ce`, archive SHA-256 `8ee7635a41fd25ee433ae937150790a95486dac7f58de77cc7e47a51dbc5988c`.

All seven images built through production `buildImages()` on Podman linux/arm64. Their fingerprints were checked again after the final clean build and all match. Their manifest is `/private/tmp/ams-stock-production.Z0IpAI/.ams/images.json`; log `/private/tmp/ams-stock-production-build.log`; complete byte-integrity report `/private/tmp/ams-stock-build-report.md`.

All 963 original TDAI files inside the four service images match the archive byte-for-byte: Core 400, Knowledge 77, Panel 284, Proxy 202. This includes source manifests and upstream locks. Knowledge's built tree and the copy executed in MCP match across 46,499 regular files. Core/Knowledge upstream dependency ranges remain unlocked because upstream supplies no npm locks. AMS adds no substitute lock or application repair.

TDAI base: Node 22 digest `sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`; observed Node 22.23.2. AMS runtime uses the pinned Node 24 base. Build reports record complete image identities and matching input fingerprints.

## Native loaders and clients

All five stock loader cases, two real stock HTTP LLM client cases and 12 dotenv quoting cases passed. Evidence and commands: `/private/tmp/ams-stock-native-acceptance.e77ZYG/evidence.json`.

The first Core fixture incorrectly called metadata storage setup without the stock gateway's preceding `applyMetadataEnvFromGatewayConfig()`. The corrected fixture now follows the actual stock startup order and passes. Production code was unchanged. Dotenv quoting follows upstream behavior, including values that cannot round-trip arbitrary quote/CR combinations. No corrective codec is injected.

## Stock MCP

Production image `sha256:1819d15f156a67c45ffc3ab0905cefea290a959a35ec4aaa024da704929f9d55` ran its own AMS runtime/dependencies and ordinary Knowledge `dist/mcp/server.mjs` build artifact under `--network none`.

The direct stdio tool list and authenticated HTTP tool list match deeply, including schemas. All 12 native query tools passed through the external access boundary. Tests covered user/session isolation, wrong-resource denial, live ACL/team/key revocation, failed initialization, recovery and process cleanup. The 47 focused access/transport tests also passed.

Evidence: `/private/tmp/ams-stock-mcp-acceptance-evidence.json`; container log `/private/tmp/ams-stock-mcp-container.log`. Core and Knowledge backends are synthetic in this protocol/authorization matrix; full-stack resource verification is recorded separately below. The retained Supergateway change only binds its listener to loopback. Stock TDAI has no source patch, wrapper correction or schema replacement.

## Full-stack lifecycle

External-model lifecycle passed in 160 seconds: all six applications and required helpers started, host bindings stayed on loopback, repeated Apply retained the administrator/service credentials, and a cold snapshot restored the same administrator into isolated Core storage. Evidence: `/private/tmp/ams-runtime-OCAM60/validation.json`; log `/private/tmp/ams-stock-runtime-external-final.log`.

The real authentication diagnostic reproduced stock behavior with the configured Core key intact: Core verification without service Bearer → 401; with service Bearer → 200/valid user; Proxy forwarding the valid user → 401 with `auth service returned HTTP 401`. No key was cleared, request patched or elevated retry added. Successful process readiness therefore does not establish usable native model forwarding.

The initial run had a fixture-only `podman-compose ps -q core` incompatibility. The test now discovers Core by engine project/service labels, as production already does. Local-CLIProxyAPI lifecycle then passed in 142 seconds, including recreation and cold credential restore. That run also created an empty Wiki through the real Knowledge API, proved stock MCP denial before its Core asset registration, registered it through the real Core API and successfully called stock `wiki_list` for `{items: []}`. No ingest or LLM call was needed. Evidence: `/private/tmp/ams-runtime-D6oun4/validation.json`; log `/private/tmp/ams-stock-runtime-local.log`.

Both isolated Compose projects and their restore containers were removed. The nine pre-existing container IDs are unchanged (`/private/tmp/ams-stock-baseline-containers.txt` versus `/private/tmp/ams-stock-final-containers.txt`). The operator's installation was not reapplied or restarted.

## Startup origin retry correction

The review reproduction exposed initial origins being persisted before successful activation. Apply now stages resolved origins for each attempt and saves them only after runtime activation succeeds. Failed attempts leave initial origins deferred, including across separate Apply invocations; explicit operator origins remain unchanged. The applied native backup is refreshed after finalization while other inputs retain their pre-start snapshot.

Regression coverage exercises Proxy, Knowledge and Panel registry URLs on port changes from 19096/18422 to 19097/18423, a later Apply after readiness failure, operator override byte preservation, and the finalized rollback baseline. Knowledge's native API base and AMS public origin are checked separately. Container and installed-package acceptance above predates this host orchestration correction; neither was rerun for it.

Fresh checks: clean `npm test` passed **416 tests, 9 skipped, 0 failed** (`/private/tmp/ams-origin-retry-full.log`); the focused server-apply suite passed **21/21** (`/private/tmp/ams-origin-retry-after.log`). Typecheck, strict OpenSpec validation and `git diff --check` passed.

## Scope and prior evidence

No provider OAuth login, real provider inference, Wiki ingestion, semantic memory, external agent, Caddy/VPS or non-arm64 acceptance is claimed. Provider authorization is stubbed in lifecycle tests; credentials/data are synthetic. Real offline export/import of all container images is separate from the deterministic bundle tests.

All earlier patched-suite/build/streaming results, including `preserve-native-tdai-configs/validation.md`, are historical. They do not prove this stock contract. Native Proxy/Core user authentication, callbacks, prompt construction and cancellation belong to TDAI; failures remain observable without local repairs.

For a future separately requested specification sync, reconcile prerequisite deltas first, then apply this change's final stock contract. Conflicts include packaged/revision templates in `preserve-native-tdai-configs`, callback/identity pairing in deployment specs, and the old two-tool replacement in `add-server-mcp-gateway`. Main specs and sibling changes have not been synchronized or archived.
