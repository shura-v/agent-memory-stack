## Context

See `proposal.md` for the motivation. The current application has five independently built images but a fixed deployment graph. The archived `containerize-agent-memory-stack` change supplies the working foundation. Both changes have been synchronized to main specs. Their acceptance is now limited to building images and starting containers; the earlier agent, semantic-memory/Wiki, and complete recovery checks are deferred, not marked passed.

Observed implementation constraints:

- `src/config/services.ts` hardcodes Core, raw Knowledge, Panel, and CLIProxyAPI network addresses; `src/config/settings.ts` and `src/setup/questions.ts` require the whole stack's settings. `src/runtime/config.ts` creates every config and data directory.
- `src/runtime/compose.ts` requires every image and applies a fixed readiness sequence. Keep its explicit `up --no-deps` orchestration: native Podman dependency handling can restart completed init jobs.
- `src/setup/interaction.ts` supports only single selection. `src/setup/server.ts` exposes initialization and device login without considering placement.
- Panel's Wiki operations use the raw Knowledge API. The public access gateway deliberately exposes only authorized tool calls. Knowledge's status callback points back to Panel and currently carries no service authentication. Panel uses completion callbacks to synchronize ready Wiki/code-graph entities into Core; disabling callbacks is not functionally equivalent to a working Knowledge integration.
- The current Compose publishes three loopback ports. Core, raw Knowledge, and CLIProxyAPI have no host bindings. Splitting these services requires explicit service interfaces and operator-managed routes.

Reuse the existing HTTP/default-address behavior and keep package/image inputs aligned with the implementation.

## Goals / Non-Goals

**Goals:** Resolve a per-machine deployment once and use it consistently for prompts, config, image requirements, Compose generation, readiness, and client guidance. Preserve existing state and authorization when placement changes. Make a complete local installation possible by accepting visible defaults.

**Non-Goals:** Remote host orchestration, automatic database/OAuth migration, high availability or replicated Core, custom arbitrary services, new provider-login implementations, registry/npm publication, and comprehensive functional validation before Supergateway and the remaining connection work are implemented.

## Decisions

### 1. Enter stack setup directly and explain placement

Running `ams` enters stack setup directly. Setup means running services on the current machine, including a developer laptop. After selecting an installation directory, show the service selection before service-specific actions or configuration. Use Clack multiselect through the existing replaceable interaction boundary.

```text
What would you like to run on this machine?

[x] Core         (memory storage, users, and permissions)
[x] Knowledge    (Wiki and document processing)
[x] Panel        (web interface for managing the stack)
[x] MemoryProxy  (adds memory context to agent requests)
[x] CLIProxyAPI  (provides API access to supported AI providers)

Space to select - Enter to continue
```

Fresh defaults select all five; this is a proposed product default based on the local-first use case. Existing installations restore their selection. An empty selection asks the user to select at least one service and performs no apply. Helpers are not choices because they exist only to implement a selected feature.

Alternative: selecting a fixed "VPS" or "local" preset hides the component choices the user requested. Named presets and a new menu hierarchy are unnecessary for the first version.

### 2. Model dependencies as local, remote, or disabled

Add a small typed deployment module containing the fixed service catalog and a pure resolver. The resolver returns selected services, required and optional connections, helper services, relevant fields, data directories, image requirements, and local readiness edges. It is the shared contract for the wizard and runtime; do not scatter checkbox conditions throughout generators.

| Local service | Required connections | Optional integrations |
| --- | --- | --- |
| Core | Direct LLM provider and memory model | None |
| Knowledge | Direct LLM provider/model; Core for its authenticated access adapter; Panel for completion callbacks and Core entity synchronization | None |
| Panel | Core service connection | Knowledge backend for Wiki; MemoryProxy origin for client guidance |
| MemoryProxy | Core service connection; CLIProxyAPI-compatible model API base/key | Knowledge tools |
| CLIProxyAPI | Its own service key and configured provider authorization | None |

Selection determines local ownership. For an unselected required dependency, ask for a remote connection. For an unselected optional dependency, offer **Connect remotely** or **Disable this feature**, initially disabled on a fresh installation. Never silently select an application checkbox. Unselected CLIProxyAPI does not remove the model-upstream requirement from MemoryProxy: ask for an existing compatible model API base and key.

Dependency resolution must distinguish configuration requirements from process-start readiness. Knowledge requires a local or remote Panel callback owner for complete Wiki integration; if Panel is not checked, ask for its remote callback connection. Panel using Knowledge creates a bidirectional connection, not a startup deadlock: start both local processes before checking the complete forward/callback path and before declaring Wiki ready. If Knowledge is disabled, suppress its injector, tool references, and Panel Wiki actions; do not satisfy mandatory config fields with fabricated URLs. Core-based memory and skill authorization remain active when Knowledge is absent.

Alternative: rely on Compose profiles alone. Profiles do not resolve cross-host addresses, remove mandatory unrelated fields, or fix runtime readiness assumptions, so they cannot be the deployment model.

### 3. Persist editable choices and derive runtime files

Keep `.env` as the user-editable settings source. Add a versioned selection field such as `AMS_DEPLOYMENT_VERSION=1` and a canonical `AMS_SERVICES` list, with explicit remote/disabled integration choices and connection fields. Exact field names belong in the typed schema and documentation during implementation. `.ams/compose.env`, generated service files, and Compose remain derived outputs. Preserve existing recognized but inactive settings and secrets so re-enabling a component can reuse them; do not inject them into unrelated containers.

Validate only the fields consumed by the resolved deployment, while rejecting malformed selection metadata and unknown field names. Generate credentials for locally owned service interfaces only; a remote service needs its existing credential. Store locally owned Core/CLIProxyAPI keys separately from remote connection credentials. Switching a dependency to remote must not overwrite the key needed to re-enable its preserved local state. Show saved values first, mask keys, and preserve exact key bytes through the existing JSON escaping/preload path.

The local port prompts precede public-origin prompts. A new local origin uses the chosen port; a saved custom origin is never overwritten by a derived value. Setup explains which service origins agents and browsers use on the same machine or remotely.

Alternative: a second user-maintained deployment YAML would introduce two settings authorities. Keep the existing single-file editing contract instead.

### 4. Separate three audiences for addresses

Resolve connections according to their caller:

- **Local container consumers:** Compose service names and container ports, generated automatically.
- **Service consumers on another machine:** an explicit service endpoint and credential, reachable from the calling container. A remote dependency's suggested address is never `localhost` or another installation's Compose hostname.
- **Agents and browsers:** operator-supplied HTTP/HTTPS origins. Preserve scheme, hostname/IP, and port; add protocol paths exactly once. Keep normal HTTPS certificate verification.

For each locally selected service, the wizard offers a separate optional "Allow service connections from another machine" setting when applicable. It only creates a loopback listener and displays the intended consumer and required authentication; the operator provides forwarding/private connectivity. Do not infer whether a service has remote consumers from this machine's checkbox selection.

Retain default user-facing ports MemoryProxy 8096, Knowledge tools 8422, and Panel 8123. When explicitly enabled for remote consumers, propose Core service port 8420, CLIProxyAPI service port 8317, and a separate authenticated Knowledge service adapter on 8423. Validate collisions across enabled host ports only. No wildcard or IPv6 host binding is introduced; IPv6 can still be an entered remote address.

Core's service interface uses its existing Bearer service key, and CLIProxyAPI uses its configured API key with management endpoints disabled. Raw Knowledge remains internal: add a separate service adapter for Panel's required Knowledge API routes, authenticated using the deployment's Core service credential already shared by these trusted consumers. This adapter is distinct from user-key/asset-ACL tool access. Bound request/response streaming and body limits must support actual Wiki uploads. The pinned Panel call sites use POST operations under `/v3/wiki/` (`create`, `get`, `ingest`, `delete`, `list`, `graph`, `search`), `/v3/wiki/raw/` (`ls`, `read`, `write`, `rm`), `/v3/wiki/page/` (`ls`, `read`, `rm`), and `/v3/code-graph/` (`create`, `list`, `get`, `sync`, `delete`, `search`, `explore`). Use that fixed allowlist and reject unrelated paths. Populate Panel's existing `KNOWLEDGE_AUTH_TOKEN` rather than adding a new outgoing-auth mechanism. Never publish raw Knowledge directly.

Patch Knowledge callbacks to send the Core service credential and Panel to verify it before processing a callback. Resolve the callback address independently from the browser origin, including the reverse connection in split installations. Require the callback owner whenever deploying functional Knowledge, and gate Wiki readiness on its authenticated path. Verify the integration tuple: the callback-owning Panel must target this same Knowledge backend and Core instance. Provide an authenticated read-only integration identity check on the trusted service boundary; use persistent deployment identities rather than the shared `ams` service label or hostname equality, since different routes may reach the same service. Reject mismatched pairings before enabling Wiki operations. Preserve creator context and entity synchronization effects; polling is not a substitute. Panel-only deployments with Knowledge disabled need no callback connection. Update affected pinned-source patches and images for these boundaries.

Alternative: forwarding every backend through the public tool gateway would merge user and service privileges. Keep separate audiences and credentials instead.

### 5. Generate the selected Compose and preserve explicit readiness

Generate a readable YAML Compose document using the resolved deployment and existing service definitions. Use the same `yaml` library as aict-cli; pin the verified stable version (2.9.1 at implementation), serialize with core schema and YAML 1.1 compatibility for Compose providers, no duplicate-object aliases, and unlimited line width. Keep secret-bearing service configs as JSON and retain the separate secret-free Compose environment. Emit only selected applications plus config, access, authenticated service adapters, and bootstrap/check jobs that are actually required. Config generation prepares only their directories/files. Project naming remains stable for the installation directory.

Image-manifest consumption must accept a verified superset or a verified subset containing every required local image. Inspect/load only required local images for deployment; preserve content identity and platform validation. The build/export pipeline can continue producing all six images by default. Adapt manifest validation APIs deliberately so a partial deployment does not weaken archive integrity checks.

Setup manages the installation's `.ams/images.json` internally and never asks for a manifest path. Applying saved configuration prepares required images for the selected engine's actual Linux architecture after the local Core administrator handoff. Reuse verified immutable image identities; build only missing required images using the existing pinned-source pipeline. Missing metadata is normal on a new installation. Malformed metadata or incompatible recorded platforms fail explicitly. Preparation returns image records in memory so the previous installed manifest remains available to the configuration snapshot before replacement. Builds may leave reusable engine cache and source files if a later check fails. Saved desired settings remain available for retry; preflight failure or declined staged start leaves runtime configuration and running application containers unchanged. Offline delivery remains available through the separate build/export/load commands.

Preflight parses the plan and Compose, checks required images and permissions, and performs read-only remote connectivity/auth checks from an ephemeral container on the intended network. Missing configuration and rejected credentials block apply. A fully configured but unavailable peer offers an explicit staged-start choice after explaining which integrations will remain pending. This permits two fresh machines hosting opposite sides of the Panel/Knowledge connection to start without deadlock. Start selected local processes, then rerun integration checks after the second machine starts; until both directions and pairing pass, report Wiki as pending and keep its operations unavailable. The ordinary ready path never silently treats unreachable peers as verified. No changes to existing application containers occur before review/confirmation. Perform local Core initialization only on its owner installation, using transient stdin. For remote Core, check an existing authorized connection and never repair metadata or bootstrap identity.

Apply the local readiness DAG with explicit `--no-deps` commands. Preserve a last-applied non-secret service inventory under `.ams/` so removed containers can be identified even after rendering a new Compose file. Stop/remove only the reviewed obsolete containers in this project, without deleting volumes or data. A failed stage reports incomplete state and leaves enough configuration/history for a retry; do not claim atomic rollback of databases.

Setup proceeds from service selection to configuration saving without a local action menu. Applying selected local Core uses the established administrator initialization flow; a selection without Core skips administrator questions. Configuration application uses the named CLI target commands; container status and logs remain available through the chosen container engine. Offer device login after installation only for locally selected CLIProxyAPI and the implemented provider flow; stop/restart only its local refresher. Documentation explains that provider compatibility is broader than the implemented login flow.

### 6. Save configuration independently of application

The wizard finishes its configuration questions and review, then ends question replay and saves desired configuration before asking **Apply configuration now?**, initially **Yes**. **No** exits successfully with **Configuration saved** and `ams apply server`. It performs no image preparation, runtime operations, or administrator initialization. Ctrl+C before the save boundary leaves previous settings intact; cancellation after saving retains the new desired settings.

Remember the absolute server installation location for the current OS user in `$XDG_CONFIG_HOME/agent-memory-stack/targets.json` (default `~/.config/agent-memory-stack/targets.json`). Store only paths, not credentials. Each successful setup updates the remembered server location. Standalone apply resolves this location independently of its working directory; a missing or invalid location produces actionable guidance rather than rerunning the wizard or guessing a directory.

Server apply reloads `.env` and the saved Compose provider, prepares missing images, performs preflight, regenerates Compose and its derived environment, and runs the existing configuration/readiness sequence with container recreation. Configuration changes do not force image rebuilds. Keep previous applied input bytes separately from newly saved desired settings so configuration snapshots still contain the actual previous inputs, including when `.env` is edited directly. Saving requires no container engine and must not read generated files owned by the container UID. Repeated saves or failed applies preserve the previous applied snapshot until success.

The administrator key is never persisted by the wizard; apply asks for it transiently when local Core requires it. First-time local Core apply may generate a key and displays it for copying; existing Core uses its existing key.

### 7. Acceptance scope

Build the required images and start the Compose deployment: selected long-lived application/support containers run, and required initialization jobs exit successfully. Record the actual engine/platform and observed container outcomes; this criterion does not establish functional correctness or production readiness.

Comprehensive functional validation is deferred until Supergateway and the remaining connection work are implemented. It includes real-provider and agent requests, streaming/cancellation/session behavior, model-visible memory and tool instructions, semantic extraction/recall and authorized sharing, Wiki ingestion/read, external Caddy access, and complete backup/restore with administrator, conversation, Wiki, and OAuth state. These scenarios are outside this archived change's acceptance checklist and are not claimed as passed.

Existing automated and local integration results remain historical evidence in `VALIDATION.md`; they do not add acceptance gates. Product preflight, authenticated remote checks, staged readiness, authorization, persistence, and image-integrity behavior remain required.

## Risks / Trade-offs

- More valid topologies increase config combinations → one resolver and explicit dependency ownership; exhaustive topology validation belongs to the later integration phase.
- Raw Knowledge and callbacks were designed around trusted local connectivity → explicit service-auth adapters/patches that reject unauthorized remote consumers.
- Moving a checkbox does not move application state → review explains data retention and requires manual backup/restore before a remote replacement is treated as equivalent.
- HTTP can be useful locally but remote routes may be unreachable → run product connectivity checks from the consuming container and distinguish local readiness from external connectivity.
- Existing artifacts may contain older fixed topology code → rebuild affected images, deliver aligned package assets, and record their identities.

## Migration Plan

1. Treat an installation without selection metadata as all five local services. Preserve its addresses, data paths, credentials, and administrator identity.
2. Save the resolved selection only after review. Back up prior generated configuration and the non-secret applied inventory for diagnostic/retry purposes; retain the same Compose project identity.
3. Apply selected local services and explicitly reviewed removals. Remote deployments remain independently managed; reuse only authorized existing remote credentials and avoid duplicate OAuth refreshers.
4. Document rollback to the previous package/images/configuration with matching data. Re-enabling a removed service reuses preserved state; never promise that transferring a service between machines also transfers its database.
5. Keep these archived planning artifacts and synchronized main specs consistent. Comprehensive validation is outside both archived acceptance checklists and is not represented as completed.
