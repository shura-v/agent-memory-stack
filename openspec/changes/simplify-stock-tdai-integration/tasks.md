## 1. Finish the upstream boundary

- [x] 1.1 Review the partial working-tree removals against this design and reconcile their callers before accepting them. Verify there are no remaining production references to deleted patch modules, `serviceConfigs`, injected native env files, `knowledge-service` or `/ams/identity`; preserve unrelated edits and add no migration path.
- [x] 1.2 Complete source/build cleanup: remove TDAI patches and copied dependency manifests/locks, use upstream dependencies and supported runtimes, and remove injected entrypoint code. Verify selected-source bytes before/after staging, repeated preparation and build-context creation; verify build fingerprints include the actual remaining inputs.
- [x] 1.3 Remove obsolete build/test/package assets and stale compiled modules through the normal clean build. Inspect the packed archive and build context for absent patch assets, native template copies and installation secrets; keep AMS-owned dependency locks.

## 2. Acquire flat native configuration

- [x] 2.1 Replace packaged-template loading and revision-indexed template stores with verified source-archive acquisition. Verify fresh Configure with download/cache fixtures writes all five originals directly under defaults, and failures preserve existing files without an engine or image build.
- [x] 2.2 Keep one native defaults-plus-overrides composition path and stock parser-compatible output. Verify unchanged override bytes, new default inheritance, explicit deletion/empty values, update/retry and coherent restore; verify ordinary Apply uses existing files without re-fetching templates or asking for/filling models.
- [x] 2.3 Adapt update and offline bundle delivery to source archives plus metadata rather than copied revision template trees. Verify offline import into an isolated installation produces the flat layout, rejects corrupt/missing source input, and preserves source/image/default pairing.
- [x] 2.4 Replace tests' packaged-template dependency with explicit deterministic source acquisition fixtures. Verify unit tests do not silently download sources or access the user's config; real-loader tests explicitly use the selected verified archive.

## 3. Use stock services and configuration

- [x] 3.1 Finish native YAML/JSON and `/app/.env` mounts, direct Panel/Knowledge links, and removal of private identity/callback wiring. Verify Compose has six applications and only config/bootstrap/access helpers, native mounts are read-only, and no TDAI process imports AMS code.
- [x] 3.2 Simplify readiness to native health/completion and retain bootstrap through stock APIs. Verify repeated Apply and cancellation preserve credentials/data; verify no identity/pairing request is made and real process failures remain failures.
- [x] 3.3 Verify custom/empty native and AMS values pass composition without semantic enforcement, including standalone check. Test actual stock dotenv/YAML behavior and remove custom-codec/literal-preservation assertions that depended on injected loaders.

## 4. Reuse stock stdio MCP

- [x] 4.1 Package and execute the unchanged selected-source MCP build artifact using native environment settings behind the existing HTTP transport. Verify initialize and tools/list match the running stock server's names/schemas; remove AMS's replacement two-tool implementation and prevent stock logs from corrupting stdio through native log settings.
- [x] 4.2 Adapt the existing internal access boundary to stock query routes and their wiki/code-graph resource IDs, adding the required service header without rewriting tool behavior. Verify successful real stock tool calls, denied resources/team membership, revoked users, unknown routes and no elevated-credential retry; expose no additional public backend.
- [x] 4.3 Retain worker/session isolation, cancellation and cleanup at the AMS transport boundary. Verify two-user isolation, reconnect, expiration, failed initialization and shutdown leave no orphan processes or leaked keys; review and remove transport workarounds that are no longer required without patching TDAI.

## 5. Reconcile evidence and operator guidance

- [x] 5.1 Update docs and superseded-delta guidance for stock behavior, flat native files, first-download/offline requirements and stock MCP tools. Verify no active instructions promise patched Proxy authentication, callbacks, prompt injection or cancellation; record prerequisite delta reconciliation without syncing or archiving specs.
- [x] 5.2 Run clean automated tests, typecheck, strict OpenSpec validation and installed-package acquisition/check tests. Record fresh counts and limits; previous patched-suite results must remain labeled historical.
- [x] 5.3 Build the unchanged selected-source images and run isolated native-loader, full-stack lifecycle and stock-MCP acceptance on the available engine. Record source/base/image identities, cleanup and exact successes/failures. Reproduce the stock Proxy/Core authentication boundary without correcting it; if an upstream build/start defect blocks acceptance, document the blocker and leave that acceptance incomplete.

## 6. Resolve startup review findings

- [x] 6.1 Finalize initially generated native origins only after successful activation. Verify bind retries and a later Apply after failed startup use the newly allocated ports, explicit operator origins remain unchanged, and the applied backup captures finalized native configuration.
