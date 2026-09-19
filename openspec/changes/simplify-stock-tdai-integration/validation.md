# Stock TDAI integration validation

Date: 2026-09-19. Automated checks use isolated synthetic installations. No container operation or live installation change was performed for the native-state removal.

## MCP process capacity — 2026-09-19

The stateless gateway now admits at most **64** active stdio children globally. At capacity, a new authenticated request sends HTTP 503 to the oldest active request, closes its SDK transports and child, waits for full release, and then starts its own child. The other 63 requests retain their processes. A request cancelled while waiting for reclaimed capacity starts no child.

The focused gateway suite passed **18/18**, including two regressions that use 64 simultaneous fixture processes. Final `npm test` passed **430**, skipped **9** opt-in checks and failed **0** (**439 total**). Build/typecheck, strict OpenSpec validation (**12/12**) and `git diff --check` passed. Container acceptance and the operator's running stack were not changed or rerun.

## Native configuration state removal — 2026-09-19

AMS no longer creates, reads, rewrites or removes `.ams-state.json`; a file with that name is unrelated operator content. `.ams/tdai-source.json` is the sole TDAI source pin. `.ams/native-config.json` stores the selected native root and initial-origin finalization. Native backups store the root, exact defaults, exact overrides and optional deletion declarations. Readers validate the supported fields and ignore extra JSON fields.

Ordinary Configure and Apply use the visible files as operator-owned configuration, including direct edits under `defaults/`. An explicit TDAI update replaces all defaults from the verified source while preserving overrides and deletion declarations. If the runtime reference is missing, a complete native root is adopted with existing origins preserved and normal saving recreates the reference.

The six focused native suites passed **125/125** before the explicit unknown-field regression was added. Final `npm test` passed **428**, skipped **9** opt-in checks and failed **0** (**437 total**). Typecheck, strict OpenSpec validation (**12/12**) and `git diff --check` passed. Tests use deterministic fixtures; no source download outside them occurred.

## Provider endpoint credential prompt — 2026-09-19

Configure now compares the entered external model API base URL with the saved value before handling the saved provider key. A changed URL opens masked key entry directly; an unchanged URL retains the keep-existing-key confirmation.

The focused Configure suites passed **47/47**. Final `npm test` passed **426**, skipped **9** opt-in checks and failed **0** (**435 total**). Typecheck passed, strict OpenSpec validation passed **12/12**, and `git diff --check` was clean. Tests use synthetic providers and credentials; no network provider request, container operation or live installation change was performed.

## Missing runtime reference — 2026-09-19 (superseded contract)

The final contract above replaces the intermediate runtime-owner recovery rule. When `.ams/native-config.json` is missing, complete `defaults/` and `overrides/` are adopted directly. No owner metadata or template provenance is required.

Final `npm test`: **425 passed, 9 opt-in skipped, 0 failed** (434 total). Typecheck passed, strict OpenSpec validation passed **12/12**, and `git diff --check` was clean. New regressions cover Configure and Apply with both default and custom native roots, plus preservation of a deliberately removed override document and deleted administrative-key override. Four initial focused failures came from test expectations retaining an `undefined` property omitted by JSON serialization; the expectations were corrected and the final suite passed.

A read-only check with the built application successfully read all five native defaults in the operator's selected root while its runtime reference remained absent. No operator files were changed and no container Apply or live-stack acceptance was performed for this fix.

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

## Stock MCP before SDK transport replacement

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

## SDK transport and single manifest follow-up

Supergateway 3.4.3 and the inspected upstream server API have no listen-host option; server-mode headers are not inbound authentication. The approved implementation removes Supergateway, its bind patch, private worker HTTP listeners and lost-session status rewriting. The installed official SDK 1.30.0 HTTP and stdio transports relay raw messages to one unchanged TDAI child per session. Authentication remains ahead of the transport. Credential groups, session limits, process cleanup and native session validation are exercised directly.

AMS and MCP now share root `package.json` and the publishable `npm-shrinkwrap.json`. SDK is a production dependency. Separate MCP manifests/locks are removed. Third-party source metadata is `vendor/upstream.lock.json`; Dockerfiles remain under deploy. A packed archive was extracted and installed with `npm ci --omit=dev --ignore-scripts`; both SDK transports loaded, Supergateway and TypeScript were absent, and the installed build context preserved the shipped manifest, lock and vendor metadata exactly. Evidence: `/private/tmp/ams-sdk-acceptance-iriPbA/package-evidence.json`.

Clean `npm test`: **416 passed, 9 opt-in skipped, 0 failed**, `/private/tmp/ams-sdk-full.log`. Typecheck, strict OpenSpec validation and diff checks passed. Build/update tests separately passed 45 checks. SDK regressions cover duplicate request IDs across independent sessions, bidirectional messages, current credential checks, failed/cancelled initialization, DELETE, crash isolation, expiration and shutdown without orphan processes.

The actual MCP target from `deploy/node.Dockerfile` built on Podman linux/arm64 as `localhost/ams-sdk-mcp-check:20260919`, image `sha256:8390e617da028877ebb85d7f66fc13e7408288282200bc979e807045fcfa7901`, Node 24.21.0; `/private/tmp/ams-sdk-image-build.log`. Inside that image, **48 transport/access/stock MCP checks passed, 0 skipped** under `--network none`, using image-owned AMS code/dependencies and stock `/opt/knowledge/dist/mcp/server.mjs`; `/private/tmp/ams-sdk-container-tests.log`. All 12 stock tools and schemas matched direct stdio and passed calls through synthetic authorized backends. Its stock artifact SHA-256 `5159230ac54a428831cee80b321ac30385a563ab0da6aa139a5e6f32711d1c49` matches the previous unchanged TDAI image exactly. Supergateway is absent. Test containers were removed; the pre/post running-container inventory was empty. Full-stack lifecycle, real provider inference and non-arm64 acceptance were not repeated for this transport follow-up.

Reference: [official npm shrinkwrap contract](https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/) explains why the single publishable lock replaces package-lock.json.

## General validation limits

### First configuration with unrelated files (historical limited fix)

This check covered unrelated files only. Its native-state ownership rule was an intermediate implementation and is superseded by the state-free contract in tasks section 13.

An operator report reproduced a false occupied-root error when the native root contained only `targets.json`. That limited fix treated `.ams-state.json`, `defaults` and `overrides` as reserved entries and passed **62/62** focused checks plus **421 passed, 9 skipped, 0 failed** in the full suite (`/private/tmp/ams-native-occupied-suite.log`). Section 13 later removed `.ams-state.json` and ownership checks entirely: the file is now unrelated, complete visible sets are adopted, and incomplete sets fail structural reading without an owner record. The historical run did not change the operator's files or containers and is not evidence for the final contract.

No provider OAuth login, real provider inference, Wiki ingestion, semantic memory, external agent, Caddy/VPS or non-arm64 acceptance is claimed. Provider authorization is stubbed in lifecycle tests; credentials/data are synthetic. Real offline export/import of all container images is separate from the deterministic bundle tests.

All earlier patched-suite/build/streaming results, including `preserve-native-tdai-configs/validation.md`, are historical. They do not prove this stock contract. Native Proxy/Core user authentication, callbacks, prompt construction and cancellation belong to TDAI; failures remain observable without local repairs.

The documentation refresh on 2026-09-19 synchronized all five active changes into seven current main specifications and reconciled overlapping contracts: source-acquired templates, three helpers, native callbacks, operator-owned values and stock stdio MCP through the official SDK. Active deltas now match the current requirements; older narratives and validation records are explicitly historical. Changes remain active and unarchived; later archive must skip spec application because synchronization is complete. Documentation validation is separate from container acceptance.
