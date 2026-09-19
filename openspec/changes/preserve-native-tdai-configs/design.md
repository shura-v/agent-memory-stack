> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## Context

See `proposal.md` for the motivation and scope. TDAI uses two visible native configuration sets: exact upstream defaults and persistent operator overrides. The deployment contract always includes the complete local stack; service-selection and remote-placement branches are removed.

AMS has never had a release. Earlier development layouts create no migration or compatibility obligation. The runtime directory remains `~/.agent-memory-stack`, separate from the native configuration root. Source/image integrity, literal credential handling, native administrative authentication and existing setup/apply interactions remain required.

## Goals / Non-Goals

**Goals:** make upstream values and installation overrides independently inspectable; preserve the complete native configuration surface; make updates use new templates with unchanged overrides; check composition integrity and structural integrity before activation; retain stable secrets, native auth, runtime identity and coherent recovery.

**Non-Goals:** convert earlier development layouts, move application data, maintain a full AMS schema for TDAI, infer renamed upstream settings, keep a third independent set of service settings in Compose, or solve upstream session-ownership authorization. CLIProxyAPI and AMS helpers retain their separate configuration lifecycle.

## Decisions

### One complete local stack

Every installation contains Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP, plus `config`, `bootstrap`, `access` and `knowledge-service`. Image preparation, validation and bundles cover six application images plus the shared runtime image. Matching images can be reused; only missing or outdated images need rebuilding.

Remove `AMS_SERVICES`, deployment-version selection metadata, placement modes, `REMOTE_*` orchestration fields, partial deployment manifests, staged starts and service-add/remove flows. All five native documents initialize together. Core/Knowledge retain independent model settings and the `external` versus `cliproxy` source choice; external model APIs and public reverse-proxy origins remain supported. Initial stack dependencies use local Compose services; native overrides remain operator-owned afterwards. No conversion of earlier development configurations is added.

### Two visible sets under the recorded native root

Resolve `$XDG_CONFIG_HOME/agent-memory-stack` or `~/.config/agent-memory-stack` once and retain it in runtime `.ams/native-config.json` with `version`, `root` and `originsFinalized`; ignore additional fields. Reject relative roots. When the reference is missing, adopt complete composable sets from the selected root with finalized operator-owned origins. Ignore unrelated files, including `.ams-state.json`. Use this layout:

```text
~/.config/agent-memory-stack/
  defaults/
    core.yaml
    proxy.yaml
    knowledge.env
    panel.env
    panel-instances.json
  overrides/
    core.yaml
    proxy.yaml
    knowledge.env
    panel.env
    panel-instances.json
    deletions.json          # optional field-removal declarations
```

`defaults/` is operator-owned and inspectable. Initial setup copies all five selected source templates and initializes their overlays together. Ordinary Configure and Apply preserve direct default edits. An explicit TDAI update replaces all five defaults from its verified source archive. No persisted template manifest, default checksum index or ownership marker exists.

`overrides/` contains partial documents in the same native formats. AMS initially fills the known installation values there; subsequent ordinary apply and template update preserve the operator's files and comments. Missing override entries mean inheritance. Overrides may add upstream-supported fields absent from defaults. A service with no overrides needs no populated overlay file. Overrides, effective runtime files and snapshots can contain secrets and use restricted permissions.

The runtime working directory, Compose identity, data paths and OAuth storage remain attached to `~/.agent-memory-stack`. Generated effective files are internal immutable container inputs, not a third user-maintained configuration set.

### Exact templates remain distributable assets

| Service | Verified upstream input | File in each set |
| --- | --- | --- |
| Core | `MemoryCore/tdai-gateway.yaml` | `core.yaml` |
| MemoryProxy | `MemoryProxy/config.example.yaml` | `proxy.yaml` |
| Knowledge | `MemoryKnowledge/.env.example` | `knowledge.env` |
| Panel | `MemoryPanel/.env.example` | `panel.env` |
| Panel registry | `MemoryPanel/config/metadata-instances.example.json` | `panel-instances.json` |

Acquire the pinned revision's complete templates from its verified source archive so save-only setup works without a checkout or engine. Offline TDAI bundles include matching source metadata and the verified source archive. Reject missing or inconsistent source assets before engine import. Distributed source artifacts contain no installation overrides, populated credentials or user data.

### Deterministic composition replaces intent inference

Compute each effective document from its current default and explicit overlay:

| Input at a field | Effective result |
| --- | --- |
| No override | Current upstream default, including absence |
| Mapping in both sets | Recursive composition by field |
| Scalar, null or array override | Exact override; arrays replace as a whole |
| Different value types | Explicit override type wins; TDAI owns semantic acceptance |
| Explicit field deletion | Field absent from the effective document |

Empty strings, false, zero, null and missing entries remain distinct. An empty mapping overlays no child values; removing a complete mapping uses the deletion mechanism. Dotenv variables are string assignments; removing an override assignment restores the default assignment.

Use optional `overrides/deletions.json` to express removals consistently across native formats. Its shape is a mapping from the five native filenames to arrays of JSON Pointer paths, for example `{"core.yaml":["/optionalSection"],"knowledge.env":["/OPTIONAL_SETTING"]}`. Pointers address mapping fields or env variable names; deleting or replacing an array operates on the whole array, not indexed elements. Reject malformed pointers, unknown filenames, root deletion and a setting simultaneously assigned and removed (including descendant assignments under a removed ancestor). Mapping containers do not make unrelated siblings conflict: overriding `llm.model` and deleting `llm.timeoutMs` is valid. Removing an absent field is a no-op so the declaration survives successive template updates. Deletion declarations are AMS metadata and never reach a native loader.

Reuse the existing YAML document and dotenv adapters. Preserve the exact defaults and unchanged override bytes; retain source comments where applicable when composing generated output. The operator edits overrides, so generated formatting does not become another editable source. No populated baseline, `seedEnv`, per-field ownership history or three-way comparison is required. Existing recovery snapshots serve rollback, not ownership inference.

### Initial population and explicit configuration edits

Known initial overrides include local endpoints, mounted paths, standalone options, chosen models and persistent service credentials. Initial Panel registry overrides replace demo instances with the AMS instance. Unknown native settings remain available through either inheritance or operator overrides.

Initial setup and first port allocation finalize missing installation choices before saving/applying the complete generation. Configure stack collects Core and Knowledge model settings and writes their reviewed values at its save boundary. Apply only reads and applies saved files; it does not discover or request models, enforce filled model fields, or write replacement model answers. Provider authorization remains an apply-time runtime operation. Cancellation before save persists no transient settings; save-only needs no engine or initial Core administrator.

After initial setup, ordinary apply and TDAI update never re-run initial population. The saved native root association identifies an initialized installation; a deliberately removed override is not reseeded. No per-service provisioning list is needed because all native services are initialized together. Small non-secret first-origin finalization state remains for deferred port allocation.

An explicit wizard operation changes only its reviewed fields in overrides and preserves unrelated content. Direct changes to orchestration `.env` do not silently rewrite explicit connection, origin or credential overrides. Pass edited connections, paths, prefixes, credentials and native listener settings through as chosen; AMS does not enforce their semantic compatibility. Native loading, authentication and readiness remain observable runtime checks. Later automatic host-port changes report the new binding and any required origin adjustment; a saved custom origin remains authoritative. This replaces the earlier promise to automatically update 'unmodified seeded consumers', which depended on a hidden baseline.

### Update defaults and retain overrides

Stage the new verified source and all five new templates. Compose them with the current overrides and deletion declarations, then check document structure. A changed upstream default does not conflict with an explicit override: the override wins. An untouched field follows the new default. Deleting an override later exposes the new default.

Report redacted paths when an upstream field addressed by an override disappeared or changed structural type. Preserve the override without interpreting its semantic validity: templates are examples, not exhaustive schemas. AMS does not run a native-value policy before activation; TDAI loaders and running services may reject incompatible values. Do not claim that every unsupported or renamed upstream option can be detected; do not relocate or discard unknown fields automatically. The operator corrects overrides and retries when a service fails loading or runtime checks.

All defaults share one selected revision. All five documents are composed and structurally checked together on every apply and update; there is no disabled-service lifecycle or historical per-service baseline.

Fingerprint the selected source, defaults, overrides and deletion declarations used for preparation. An intervening edit invalidates the candidate before activation. Retry re-reads the same visible sources; remove the former `native-pending/resolved.json` resolution workflow. Pending source selection and temporary generated files remain internal preparation state.

### Effective values are the sole service input

Runtime planning, connection details and container transport read the same composed configuration. Each Core/Knowledge consumer retains its own endpoint, credential and model, including switching to external routing without obsolete private seed credentials. The explicit read-only connection screen shows the effective value and identifies the override/default owner. Every service is part of the local stack, and private listener status remains distinct from service presence.

Containers receive restricted immutable generation files through per-service read-only mounts, readable by service UID 10001. Knowledge and Panel load the composed native env documents. Preserve literal credentials, including quotes, dollar signs and backslashes, through existing tested transport. Core/Proxy native loader precedence remains relevant: any required environment variables are derived from the effective document and agree with it. Compose must not introduce independent conflicting service values.

The pinned Proxy supports `TDAI_PROXY_ADMIN_API_KEY`, while some other YAML/JSON fields have no environment override. Therefore composition happens at the native document level for every format; a service's optional environment support does not restrict the editable surface.

### Configured values belong to the operator

AMS checks document syntax, overlay/deletion instructions, runtime reference shape, prepared-input fingerprints, selected source integrity and image records. These checks protect composition and activation integrity without assigning ownership by checksum. Remove AMS policy checks on native service and orchestration values, including host/native ports, DATA_DIR, engine/provider choices, bind addresses, paths, URLs, API prefixes, models, timeouts, token limits, credentials and cross-service equality. Standalone configuration check reads the complete composed installation and applies only structural checks.

The operator's native values reach service documents and derived environment transport as chosen. Service loaders can reject them and startup/authentication/readiness can fail after activation. Such failures preserve recovery information and require operator correction; semantic preflight success is not promised. This change does not propagate custom prefixes, native ports or paths into other helper contracts: helpers and readiness keep their existing `/v3` routes and fixed connections. Accepting a custom value is not evidence that the integrated stack supports it.

### Optional Core service authentication

AMS does not generate or initially seed Core `server.apiKey`. The selected original template leaves it empty; absent overrides inherit that value. Explicit operator keys and native consumer credentials remain supported and survive Configure, Apply and updates. Ordinary Apply never clears an existing key to make stock Proxy work. Removing a previously generated key from a live installation is an explicit operator configuration change, not a migration or automatic upgrade step.

An empty key disables Core's native service guard, including Core administrative routes without separate user authentication. Core stays unpublished by default. Proxy still verifies the agent's Core user key; its independent `admin.apiKey`, Core's initial administrator identity and AMS MCP/access user/resource checks are unchanged. A nonempty operator Core key can reproduce the stock Proxy verification failure because that upstream client omits the service Bearer; source code remains unchanged.

Stock clients still require nonempty token fields when Core does not compare a service secret. Initial setup preserves Proxy's template `local` values for `tdai.apiKey`, `skill.serviceToken` and `knowledge.serviceToken`; the initial Panel instance uses `api_key: "local"`. These are public native client values, not Core authentication or user keys. Explicit operator consumer values remain authoritative, and ordinary Apply does not repopulate them. No upstream source change is involved.

### Native administrator credentials remain persistent

Initial Proxy provisioning generates an independent 32-byte `sk-ams-proxy-admin-...` value in `overrides/proxy.yaml` at `admin.apiKey` when the operator supplied none. Repeated apply and default refresh preserve it exactly. After initial setup, native credential edits remain operator-owned. AMS permits empty, removed, deleted or reused credentials without semantic validation or regeneration. Missing assignments inherit the current default and explicit deletions remove it; native authentication determines the effect.

Keep the upstream native `checkAdminAuth` integration in both the outer guard and administrative handler. Add no route allowlist or Panel user-key substitution. Core's initial administrator key remains transient and is not a second persisted service secret. This protects native administrator routes and does not fix separate upstream session handlers without ownership checks.

### Coherent activation and recovery

Check document structure, overlay/deletion rules, runtime reference shape, selected source integrity, required image identities and complete preflight before switching active default/source/image records or stopping services. Malformed documents or deletion instructions, invalid AMS orchestration, concurrent input changes, missing assets and failed image preparation leave the prior active generation intact. Preserve the operator's desired defaults and overrides for correction and retry; do not silently undo their edits.

Native backups carry `root`, exact defaults, byte-preserved overrides and optional deletion declarations, while `.ams/native-config.json` carries the root and initial-origin state and `.ams/tdai-source.json` carries the selected source. Additional backup/reference fields are ignored. If startup fails, retain the previous coherent generation for explicit recovery. Restore both sets and the separate reference/source/image records together, so a subsequent apply reproduces the restored effective configuration. Reject incomplete TDAI snapshots before writes. Configuration recovery does not roll back application database changes.

## Risks / Trade-offs

- Native templates are not complete schemas → preserve additions and native values, use structural integrity checks and redacted changed-path diagnostics, and state the limits of rename detection.
- Explicit overrides intentionally mask changed defaults → show both sets and document that removing an override opts into the current upstream value.
- Initial known values and later manual topology edits can disagree → pass native edits through and report actual runtime failures; ordinary apply preserves operator files.
- Literal values cross YAML/env/container interfaces → reuse adapters and actual loader tests; avoid shell evaluation or recursive credential interpolation.
- Two host roots complicate recovery → keep installation identity fixed and snapshot both configuration sets with their matching source and images.

## Implementation transition and verification

Replace the current development implementation in place; add no conversion or compatibility path for earlier development layouts. Rewrite the overlay, update and recovery tests against fresh isolated installations. Retain source-integrity and native-auth coverage, then rerun packed-package, loader and container acceptance for the revised contract.

`validation.md` and `runtime-validation.md` distinguish earlier runs from full-stack acceptance. Previous success counts do not establish acceptance of the full-stack cleanup; current checks are recorded separately with exact runtime and package evidence. Configured-value ownership and Configure-only model acceptance remains pending until section 7 is completed.

## Specification integration order

Synchronize completed deltas in this order only when requested: `use-cliproxy-for-internal-models`, `print-agent-connection-info`, then `preserve-native-tdai-configs`. The first owns the Apply requirement rename; this change modifies its final name. The native change supplies the final two-set ownership, explicit override precedence and effective connection-information contracts. Main specs and sibling changes remain unchanged during this planning revision.
