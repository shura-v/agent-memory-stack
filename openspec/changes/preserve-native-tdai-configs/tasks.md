## 1. Visible configuration sets and composition

- [x] 1.1 Extract all five templates from the verified selected TDAI archive with source revision, paths and digests. Existing template tests verify missing files, checksums and revision mismatches; reuse this component for defaults.
- [x] 1.2 Store complete raw templates in `defaults/` and partial native documents in `overrides/` under the recorded native root. Verify XDG/default roots, independent runtime identity, exact template bytes, default-tamper errors, restricted override permissions and rejection of occupied unassociated roots.
- [x] 1.3 Replace three-way document merging with deterministic defaults-plus-overrides composition for YAML, dotenv and JSON using existing adapters. Verify nested maps, atomic arrays, scalar/type replacement, null/empty/false/zero, additions, removed overrides falling back to defaults, comment retention and literal special-character credentials.
- [x] 1.4 Implement `overrides/deletions.json` as the explicit field-removal mechanism described in the design. Verify JSON Pointer escaping, missing-target no-ops, whole-array deletion, invalid filenames/paths, assign/delete conflicts, and absence of deletion metadata in native output.

## 2. Initial overrides and operator ownership

- [x] 2.1 Move initial known-field population into partial overrides and retain only non-secret initial-origin metadata. Verify complete defaults stay unmodified, supplied overrides/deletions remain intact, ordinary apply preserves override bytes, and deleting an override restores inheritance without reseeding it.
- [x] 2.2 Adapt setup/save/apply and first port allocation to targeted override writes. Verify save-only operation without an engine, cancellation boundaries, Configure-only model persistence and apply-time provider authorization, explicit wizard edits preserving unrelated fields, and later host-port change guidance without silently changing overrides.
- [x] 2.3 Store the separate generated Proxy `admin.apiKey` in its override document during initial installation setup. Verify independent 32-byte entropy, supplied-key preservation, stable repeated apply/update, no persisted Core initial administrator copy, and preservation without reseeding after operator removal/emptying/deletion or reuse of the administrative credential.
- [x] 2.4 Read effective per-service model connections from composed documents. Verify CLIProxyAPI → external and external → CLIProxyAPI → external with independent Core/Knowledge overrides, explicit source-appropriate configuration changes, repeat apply, and literal preservation of edited connection/key values without private seed credentials or inferred ownership.

## 3. Container input and connection information

- [x] 3.1 Derive immutable generation files, service mounts and necessary environment transport from effective documents. Verify per-service access, read-only mounts, service UID readability, no competing service-setting copies, and exact edited values/credentials through real upstream loaders for all four TDAI services.
- [x] 3.2 Retain upstream `checkAdminAuth` integration in the outer Proxy guard and native administrative handler without a route allowlist. Existing proxy-admin integration tests cover a separate admin key, ordinary users, missing/wrong keys and denied deletion; rerun them during final validation.
- [x] 3.3 Adapt connection details and existing-stack guidance to defaults/overrides and effective values. Verify source-file labels, independent consumer settings and private listener credentials, separate Proxy administrator labeling, read-only behavior, secret redaction outside the explicit screen and no guessed configuration roots.

## 4. Template updates, activation and recovery

- [x] 4.1 Replace populated-baseline rebasing with new-defaults composition using byte-preserved overrides. Verify successive updates, new defaults inherited only without overrides, explicit override precedence across upstream value/type changes, override removal, additions/deletions and redacted removed/type-changed upstream path diagnostics without a full-field allowlist.
- [x] 4.2 Check staged document structure, provenance and matching images before active replacement; remove the resolved-candidate workflow. Verify malformed documents or deletion/provenance failures and image failures preserve the active generation, user fixes in overrides are read on retry, and concurrent source/default/override/deletion edits invalidate prepared activation.
- [x] 4.3 Refresh all five default templates together while retaining every override. Verify successive updates preserve override bytes and secrets, compose all native service documents before startup, and require no per-service provisioning list or historical baseline.
- [x] 4.4 Snapshot and restore both sets, deletion declarations, manifest, initial-origin state, root reference and matching orchestration/source/image records. Verify reproducible effective settings after restore, interrupted activation recovery, strict incomplete-snapshot rejection and refusal to reuse an unassociated native directory.
- [x] 4.5 Keep package and offline-bundle delivery limited to raw templates and provenance. Verify packed-package save-only initialization into both sets without network/engine access, exact selected-revision offline import, complete-asset checks before engine use and exclusion of overrides, credentials and populated runtime state.

## 5. Cleanup, documentation and acceptance

- [x] 5.1 Remove obsolete private seed settings, populated baselines, three-way merge/conflict resolution and old lifecycle tests after their replacements pass. Verify no apply/update path reads that state, no development-format migration is introduced, and unaffected menu/provider/bootstrap/auth behavior remains covered.
- [x] 5.2 Update and run isolated full-stack runtime smoke fixtures for both sets. Verify native effective settings, immutable mounts, repeated apply and cold Core credential recovery on the available engine; record platform/image identities and separate untested real OAuth/inference.
- [x] 5.3 Update English setup/configuration/update/recovery documentation with the two visible sets, examples of override inheritance and deletion, explicit edit ownership, template-change diagnostics and the precise native admin-key scope. Verify paths and commands against the implemented CLI and remove obsolete baseline/resolved-candidate instructions.
- [x] 5.4 Run `npm test`, `npm run typecheck`, packed-package verification, relevant native-loader/container acceptance and `openspec validate preserve-native-tdai-configs --strict --no-interactive`. Refresh validation records for the current full-stack contract, distinguish prior runs from new acceptance, and retain the documented prerequisite delta-sync order.

## 6. Fixed full-stack composition

- [x] 6.1 Remove application-service selection, placement modes, remote stack dependencies, partial-image manifests, staged starts and helper-only native-state branches. Always initialize six local applications, four support containers, seven images and five native documents; preserve internal LLM source selection, model/auth flows, cancellation, snapshots and runtime credential authentication.
- [x] 6.2 Replace subset/split-placement fixtures with full-stack invariants and update operator documentation and existing delta requirements. Keep main specs untouched until explicitly requested synchronization; record current container/package acceptance under 5.2 and 5.4.

## 7. Operator-owned values and Configure-only model questions

- [ ] 7.1 Remove all AMS configured-value validation for native TDAI and orchestration settings, including ports, DATA_DIR, engine/provider values, URLs, paths, prefixes, models and credentials. Preserve initial known-value/key generation, structural/provenance/ownership/concurrency/deletion checks, image integrity and actual runtime authentication/readiness. Configure collects models; Apply performs no model discovery, prompting, enforcement or reseeding.
- [ ] 7.2 Make standalone configuration check load the composed installation and check only structural/provenance integrity. Add regressions for custom/empty native and orchestration values, complete Configured model persistence, no Apply model discovery/prompts, and actual execution failures without a preflight value policy.
- [ ] 7.3 Refresh docs/specs and current tests/acceptance evidence for the expanded ownership boundary. Verify that custom prefixes are passed through without claiming helper-route support, existing `/v3` helper routes remain unchanged, and runtime failures remain distinguished from structural configuration errors.
