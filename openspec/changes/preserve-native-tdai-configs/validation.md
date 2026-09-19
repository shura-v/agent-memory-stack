# Full-stack native configuration validation

Date: 2026-09-19. This record covers the two visible native sets, fixed full stack, operator-owned values and Configure-only model questions. Earlier service-subset and split-deployment results do not establish acceptance for this implementation.

## Automated checks

| Check | Result |
| --- | --- |
| Clean build followed by `node --test tests/*.test.mjs` | 419 total: 410 passed, 0 failed, 9 opt-in tests skipped |
| `npm run typecheck` | Passed |
| `git diff --check` | Passed |
| Isolated full-stack runtime | External 1/1 and local CLIProxyAPI 1/1 passed |
| Synthetic model / L0 / SSE | Prior full-stack run passed; not rerun for the value-ownership change |
| Real upstream native loaders | 5/5 passed on Podman linux/arm64 |
| Installed npm package save-only setup | Passed offline from current packed distribution |
| Strict OpenSpec validation | Passed with two documented informational delta-sync prerequisites |

Suite log: `/private/tmp/ams-operator-values-tests.log`. The initial clean `npm test` exposed one obsolete connection-screen expectation; after its correction the complete suite above passed without further source changes.

Focused tests cover recursive object composition, atomic arrays, null/empty/false/zero values, literal credentials, comments, aliases, inherited fields and explicit JSON Pointer deletions. Lifecycle tests cover exact defaults and tamper detection, byte-preserved overrides, successive template updates for all five native documents, independent generated Proxy administration, model-source switches, targeted wizard edits, first allocated origins, concurrent edits and root ownership. Pending-update cancellation persists chosen models against active defaults; retry activates matching templates and images together. Recovery requires exact two-set/deletion/provenance snapshots and matching source/image records.

Full-stack regressions verify all six services, four helpers and seven images; retain unknown settings without changing composition; initialize all five defaults and overrides on the first save; and generate the initial independent Proxy administrative key. Later empty, deleted or reused credentials are preserved. Image preparation reuses valid images and builds only missing or outdated images, while deployment and delivered bundles always require the complete set. Connection details shows configured credentials and their native sources for all consumers.

Setup tests cover save-only Configure, manual local model names without engine access, external model discovery, cancellation and saved baselines. Apply preserves empty/unlisted models without questions or discovery, starts the full stack and then performs provider authorization. Standalone check reads native composition, accepts arbitrary native and AMS values, fails on malformed native YAML and leaves input bytes untouched. Structural/provenance/ownership/concurrency and real runtime authentication checks remain. Custom Knowledge prefixes pass through; helper routes still use `/v3`, and custom-prefix runtime compatibility is not claimed. No development-format migration, service provisioning list, private seed, populated baseline, three-way merge or resolved-candidate workflow remains.

## Container and package acceptance

Current isolated container evidence is recorded in [runtime-validation.md](runtime-validation.md). Every fixture uses synthetic credentials and separate runtime/native roots. The obsolete placement smoke suite was removed; model smoke now exercises the real local CLIProxyAPI with an isolated synthetic provider configuration.

Current package acceptance passed 6/6 groups at `/private/tmp/ams-owned-values-package.BYcMQd`: `report.md` records exact offline pack/install/verification commands and `verify.log` records success. The installed package supplies all five exact upstream defaults, partial overrides and an independent Proxy admin key without network, engine or image operations. Local Configure collects both models; installed check accepts empty models/custom values and rejects malformed YAML without writes. Its deployment has six applications, four helpers and seven required images. The archive contains original templates and provenance, excluding installation overrides, credentials and runtime state.

Real provider OAuth/inference, production deployment, Docker Linux amd64, semantic memory quality and application database rollback are outside these checks.

## OpenSpec reconciliation

Synchronize/archive in this order: `use-cliproxy-for-internal-models`, `print-agent-connection-info`, then `preserve-native-tdai-configs`. The first owns the `Apply the fixed configuration` requirement rename; the second introduces `Concise read-only agent connection information`. Missing main-spec headers for those changes are informational archive prerequisites. This implementation does not sync or archive changes.
