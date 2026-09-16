## Context

See proposal.md for scope. `src/setup/questions.ts` currently owns service checkboxes, dependency mode choices, service-interface confirmations, port inputs, and service-origin prompts. `src/config/settings.ts` already defines defaults; `src/deployment/model.ts` derives internal endpoints and published interfaces. The resolver and `.env` support split deployments independently of the UI.

The apply path currently renders configuration before image preparation, and runtime application rereads `.env`. Automatic port assignment must precede the final render and applied-input capture. The project identity is derived from its absolute installation directory. Existing Compose labels and the applied service inventory distinguish this project's containers from unrelated ones. There is no existing automatic allocator.

## Goals / Non-Goals

**Goals:** A short Configure stack flow, stable automatic host ports, correct generated URLs, and retained manual configuration for existing or advanced deployments. Preserve save-only operation without a working container engine.

**Non-Goals:** Managing Caddy, DNS or TLS; changing internal container ports; removing split-deployment support; hiding provider configuration; changing the approved Connect an agent text; implementing MCP in this change; adding release automation.

## Decisions

### 1. Derive topology and keep explicit configuration

For a new installation, use all implemented application services. Today those are Core, Knowledge, Panel, MemoryProxy, and CLIProxyAPI; MCP joins the fresh default when its separate implementation is available. An existing explicit `AMS_SERVICES` value remains authoritative, including a partial stack. Existing dependency modes and remote addresses remain reusable; missing required advanced values produce an `.env` instruction instead of another topology/address prompt.

Remove the checkbox, dependency-placement choices, all stack origin/port questions, and all three service-interface confirmations. Preserve the current disabled default for Core, CLIProxyAPI, and Knowledge service interfaces and honor saved/manual enable flags. Their optional listeners use the same allocator when enabled. Publish Panel, MemoryProxy, and MCP automatically, without enablement questions. The direct Knowledge HTTP tools gateway also remains unpublished by default; keep it reachable inside Compose for MCP authorization and forwarding. Preserve advanced explicit exposure settings in .env, but an old Knowledge port or origin by itself is not an exposure opt-in.

Keep Configure stack selected by default in the explicit menu alongside Apply configuration. The latter uses the same saved-target workflow as standalone `ams apply`; the existing-stack guard applies only to Configure stack. Keep installation/data directory, real LLM API base/key, models, memory prompt mode, log level, administrator key handling, review, and apply choice. Generate a missing locally owned Core or CLIProxyAPI service key automatically and reuse each saved key without any confirmation, generation choice, or manual-entry question. Cache fresh keys across back navigation and persist them at the existing save boundary. Explicit .env keys remain authoritative; invalid saved keys produce named validation errors instead of silent rotation. Remote service credentials and real provider credentials are never generated as replacements. The administrator key for Panel remains in its separate existing flow. The provider API base cannot be derived from a stack port. Advanced settings remain documented in `.env`; do not introduce an alternative advanced wizard.

### 2. Resolve ports during apply in the selected engine

Saving stores preferred settings without probing ports, starting containers, or requiring Docker/Podman. Apply checks its provider and prepares required images first. Then resolve the complete published-interface map before rendering final Compose, generated service configurations, or capturing the final applied inputs.

Image reuse must match this package's build inputs as well as immutable identity/platform. The new configuration fields cannot be handed to an older runtime validator. Record a deterministic build-input fingerprint as an image label and rebuild required images with a missing or different fingerprint before stopping services. Identical images loaded from a bundle remain reusable without a source download; configuration-only edits do not change the fingerprint. Keep installation secrets and data outside the fingerprint inputs.

Prefer a saved port; otherwise use the existing defaults for published services: MemoryProxy 8096 and Panel 8123. MCP uses its separate change's default when available. Core 8420, CLIProxyAPI 8317, Knowledge tools 8422, and Knowledge service 8423 are advanced opt-in mappings only. Do not allocate host ports for them in the default stack. Maintain a distinct port per published listener.

Use an ephemeral, project-labelled helper from the existing runtime image to exercise a real `127.0.0.1` port publication through the selected engine. On a confirmed binding conflict, ask that engine for an available published port and inspect the assigned mapping. Hold temporary reservations until the relevant startup phase; clean them up on success, cancellation, and failure. Use public engine commands, not assumptions about daemon implementation.

A local Node socket probe alone is insufficient for Podman machines, Docker contexts, or remote engines. The helper uses the actual selected runtime and its port-forwarding path. Retain the existing supported engine/filesystem scope: automatic allocation does not introduce deployment to arbitrary remote hosts.

### 3. Reuse owned listeners and bound retries

Inspect the runtime's actual published bindings. Reuse an existing binding only when the container belongs to this exact project and expected managed service and matches the intended mapping. Do not classify another project's listener as reusable or stop it. Existing own listeners need no competing helper reservation.

Port probing cannot eliminate the gap between reservation release and service startup. If the actual service bind loses that race, rerun allocation for that interface and regenerate dependent settings, with a bounded retry count. Restrict retries to recognized binding conflicts. The current process wrapper suppresses stderr; add a narrow sanitized diagnostic result for allocation/startup so an arbitrary exit 125, missing provider, permission error, or image failure cannot be misclassified as an occupied port. Exhaustion reports the service and stage rather than looping indefinitely.

### 4. Persist one consistent network result

Persist resolved port values into the installation `.env` before final configuration generation. Keep non-secret allocation provenance in the installation's `.ams` metadata, integrated with the existing snapshot lifecycle. Store the last generated local origin per service so later runs distinguish generated values from operator overrides. New values and prior matching generated values follow a changed port; operator-edited origins remain unchanged. On first upgrade, treat a canonical localhost/127.0.0.1 origin matching that service's old saved port as generated; preserve other legacy origins.

Regenerate only generated local host origins; preserve Caddy domains, explicitly configured external URLs, provider API prefixes, and container DNS endpoints. A changed host port must not change internal Core/Knowledge/Panel callback routing. Review and final output identify actual mappings and changed ports so the operator can update their Caddy upstream if needed.

Capture previous applied bytes before allocation modifies desired settings, then record final resolved bytes as the new applied configuration only on the existing success path. Failed apply keeps retryable resolved settings without claiming that services run. Do not rotate keys or rewrite data during a port retry.

### 5. Explain local and remote behavior without questions

Print a short explanation that only Panel, MemoryProxy, and MCP have default host entry points and external domains can be set in `.env`. Panel-generated client endpoints still consume advertised origins. Agents access Knowledge through MCP; its server-side adapter calls the protected Knowledge gateway inside Compose. Suppress direct Knowledge HTTP tool instructions when no explicitly exposed, agent-reachable Knowledge HTTP entry point is configured. Keep ordinary memory/skill instructions and internal Wiki/document processing active. Advanced deployments can explicitly enable direct Knowledge HTTP exposure in .env; only then advertise its reachable origin. A generated internal or localhost URL is not evidence of remote reachability.

The connection-information change reads the resolved saved ports and preserves its approved wording. It continues to distinguish configured values from live state.

## Risks / Trade-offs

- Helper publication is an apply-time effect → keep it after the save/apply boundary and remove only helpers belonging to this operation.
- Published-port conflicts can occur after allocation → bounded, conflict-specific retries with consistent environment/Compose regeneration.
- Changing a port may invalidate a Caddy upstream → retain stable saved ports when possible and print any reassignment.
- Legacy origins have no provenance → use the documented canonical-local-origin migration rule and preserve every other saved origin.
- Independent active changes overlap → this change supersedes the MCP checkbox/port prompt and fresh-install opt-in design; reconcile those artifacts during implementation without reviving old prompts.

## Migration Plan

Keep the existing `.env` topology and service-interface fields and add explicit opt-in metadata for direct Knowledge HTTP publication. Missing opt-in means private, including older configurations that merely contain KNOWLEDGE_PORT or KNOWLEDGE_PUBLIC_URL. New setup removes questions while apply keeps support for explicit configurations. Applying the default policy removes this installation's former Knowledge host mapping and direct HTTP tool advertisement while retaining its internal gateway and data. Add allocation metadata to existing configuration snapshot/restore handling. Retain current applied settings as the rollback baseline.

Implement together with, or after reconciling, `add-server-mcp-gateway` and `print-agent-connection-info`. MCP is not reported as installed before its implementation. The only current-stage acceptance task remains building required images and starting containers; full topology, agent, memory, and authorization validation is deferred.
