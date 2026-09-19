## Why

Operators need the complete TDAI configuration surface and a clear distinction between upstream defaults and installation choices. Two visible sets let a TDAI update replace its templates while preserving explicit operator overrides, without reconstructing intent from a previous populated baseline.

## What Changes

- Store two visible sets under `$XDG_CONFIG_HOME/agent-memory-stack` (default `~/.config/agent-memory-stack`): `defaults/` contains the complete unmodified templates of the selected verified TDAI revision; `overrides/` contains native-format partial configuration initially populated with known AMS deployment values and subsequently owned by the operator.
- Compose effective service configuration as `defaults + overrides`. Mappings combine by field, arrays replace as a whole, and explicit override values win. Removing an override restores the current default; a documented deletion manifest removes a field from the effective document.
- Refresh all default templates on TDAI updates and preserve override files. Check syntax, overlay/deletion rules, provenance, root ownership, concurrency and structural integrity before activation. Pass native values through unchanged; native loaders and runtime readiness determine service acceptance. Remove private populated baselines, seed credentials, three-way merge conflict resolution, and automatic inference of user intent.
- Preserve runtime identity, data, secrets, coherent configuration recovery, offline delivery, and the native MemoryProxy `admin.apiKey` integration. Snapshots contain both visible sets and matching source/image provenance. AMS has never been released; development-format migrations and compatibility paths are outside the contract.
- Always deploy all six application services and four support containers using the complete seven-image set. Initialize and structurally check all five native documents together. Remove service selection, split placement, disabled-service and helper-only modes; preserve external versus CLIProxyAPI internal LLM routing.
- Keep orchestration choices in AMS `.env`. Derive service settings, connection details, and container inputs from the composed native configuration. Compose/environment transport carries those effective values rather than maintaining an independent override layer.

- Remove AMS validation of configured values in both native TDAI files and AMS orchestration. Preserve initial known-value and independent administrative-key generation, then retain user edits without enforcing fixed ports, paths, URL/prefix shapes, model names, credential contents or connection equality. Standalone check loads composed settings and checks document integrity and provenance. Configure stack owns model questions; Apply applies saved files without model discovery, prompts or required-model enforcement.

## Capabilities

### New Capabilities

- `native-service-configs`: revision-matched defaults, visible persistent overrides, deterministic composition, template updates, structural integrity and native administrative authentication.

### Modified Capabilities

- `stack-delivery`: package complete templates, save the two visible configuration sets, protect secrets, and recover them with matching runtime state.
- `server-deployment`: setup populates initial overrides; updates replace defaults while retaining explicit operator settings.
- `deployment-composition`: save, apply, structurally check and mount the composed native configuration while preserving installation identity and user-owned overrides.
- `host-installation`: read-only existing-stack guidance identifies defaults and editable overrides through the recorded native root.

## Impact

The main implementation paths are `src/config/native-{documents,services,state,templates}.ts`, `src/runtime/{config,environment,render-compose,snapshot,restore-native}.ts`, `src/setup/{server,server-settings,connection-info}.ts`, and `src/build/{bundle,update-tdai}.ts`. Setup/update/recovery tests, container smoke fixtures and operator documentation must adopt the two-set contract. Existing template extraction, native loader transport and native proxy authentication can be reused where they satisfy it.

The full-stack revision supersedes earlier partial-deployment behavior. Earlier acceptance is recorded in `validation.md` and `runtime-validation.md`; the configured-value ownership and Configure-only model changes require the new evidence tracked in section 7 of tasks.md. Main specs and sibling changes remain outside this implementation; synchronization and archival require a separate request.
