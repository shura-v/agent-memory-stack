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
- [x] 4.3 Earlier stateful implementation, superseded by section 9 below: retain worker/session isolation, cancellation and cleanup at the AMS transport boundary. Verify two-user isolation, reconnect, expiration, failed initialization and shutdown leave no orphan processes or leaked keys; review and remove transport workarounds that are no longer required without patching TDAI.

## 5. Reconcile evidence and operator guidance

- [x] 5.1 Update docs and superseded-delta guidance for stock behavior, flat native files, first-download/offline requirements and stock MCP tools. Verify no active instructions promise patched Proxy authentication, callbacks, prompt injection or cancellation; record prerequisite delta reconciliation. The subsequent 2026-09-19 documentation refresh synchronized main specs and current deltas without archiving.
- [x] 5.2 Run clean automated tests, typecheck, strict OpenSpec validation and installed-package acquisition/check tests. Record fresh counts and limits; previous patched-suite results must remain labeled historical.
- [x] 5.3 Build the unchanged selected-source images and run isolated native-loader, full-stack lifecycle and stock-MCP acceptance on the available engine. Record source/base/image identities, cleanup and exact successes/failures. Reproduce the stock Proxy/Core authentication boundary without correcting it; if an upstream build/start defect blocks acceptance, document the blocker and leave that acceptance incomplete.

## 6. Resolve startup review findings

- [x] 6.1 Finalize initially generated native origins only after successful activation. Verify bind retries and a later Apply after failed startup use the newly allocated ports, explicit operator origins remain unchanged, and the applied backup captures finalized native configuration.
- [x] 6.2 Allow initial native configuration alongside unrelated files such as targets.json. Preserve those files. The original unconditional refusal of native entries without a runtime reference is superseded by section 10 below.

## 7. Separate third-party inputs

- [x] 7.1 Keep third-party source metadata under vendor and AMS Dockerfiles under deploy. Remove separate MCP dependency metadata and use the root package.json plus publishable npm-shrinkwrap.json for AMS and MCP (superseded by section 8 below). Update package resources and build inputs, verify context/package delivery and production dependency installation, and investigate stock Supergateway binding options without changing upstream code.
- [x] 7.2 Earlier stateful SDK implementation, lifecycle superseded by section 9 below: remove Supergateway and its bind patch. Connect the official SDK HTTP and stdio transports directly inside the authenticated AMS gateway; retain unchanged native tools, per-credential session isolation and complete child cleanup. Verify transport behavior, package/build contents and the stock MCP container path.

## 8. Root npm lockfile

- [x] 8.1 Replace npm-shrinkwrap.json with the single tracked root package-lock.json. Supply a generated lock copy to installed-package image builds, retain npm ci for container dependencies, and verify the packed package contains the build resource without a shrinkwrap.

## 9. Request-scoped MCP transport

- [x] 9.1 Replace persistent credential groups and MCP sessions with the SDK stateless Streamable HTTP transport. Each authenticated POST owns an isolated unchanged stock stdio process using the caller credential and closes it when the response completes, aborts or fails. Remove pools, leases, session maps and TTL/reaper logic while retaining user/resource authorization and the existing /mcp URL.
- [x] 9.2 Replace stateful lifecycle tests with request isolation, native initialization/tool forwarding, independent concurrent requests, revoked/invalid credentials and child cleanup on completion/abort/failure. Check the installed SDK's actual stateless behavior; keep TDAI unchanged and record any unsupported capabilities.
- [x] 9.3 Reconcile current docs/specs and diagrams with request-scoped transport, then record focused/full tests and any container acceptance separately from earlier stateful evidence. Retain earlier validation as historical and do not infer live agent acceptance from process readiness.

## 10. Reuse native configuration without its runtime reference (superseded implementation)

- [x] 10.1 The intermediate implementation reused runtime-owned native state when `.ams/native-config.json` was missing. Section 13 replaced ownership and provenance metadata with direct adoption of complete visible sets before release.
- [x] 10.2 Verify missing-reference Configure and Apply regressions in isolated installations, including preserved edits/secrets and deliberate overlay removal. Section 13 retains these user-visible outcomes without native state or runtime ownership.

## 11. Refresh provider credentials with their endpoint

- [x] 11.1 When Configure changes the external model API base URL, skip the saved-key confirmation and request a new masked API key. Preserve the confirmation when the URL is unchanged, and cover both paths with workflow tests.

## 12. Name native TDAI metadata explicitly (superseded)

- [x] 12.1 This intermediate metadata rename was replaced by section 13 before release. The final contract creates and consumes no `.ams-state.json`.

## 13. Remove native configuration state

- [x] 13.1 Remove `.ams-state.json`, persisted template manifests, default-file checksums and runtime ownership metadata. Keep the source pin in `.ams/tdai-source.json`; store only the native root and initial-origin finalization in `.ams/native-config.json`.
- [x] 13.2 Treat complete defaults and overrides as operator-owned configuration, including when the runtime reference is missing. Ordinary Configure and Apply preserve both sets; an explicit TDAI update replaces all defaults from the selected verified archive and preserves overrides and deletion declarations.
- [x] 13.3 Update snapshots, restore, tests and operator documentation for the smaller contract. Verify no state file is created, direct default edits apply, missing-reference recovery recreates the reference, update replaces defaults, and rollback retains exact visible files and origin state. Readers ignore additional JSON fields in runtime references and backups.

## 14. Bound request-scoped MCP processes

- [x] 14.1 Limit the gateway to 64 active stdio children globally. At capacity, terminate and release the oldest active request before spawning the new child, without disturbing newer requests or retaining a queue.
- [x] 14.2 Add regression coverage for oldest-request eviction, the 64-process bound, slot release after completion and orphan-free shutdown. Update current MCP documentation and validation separately from earlier stateless transport evidence.
