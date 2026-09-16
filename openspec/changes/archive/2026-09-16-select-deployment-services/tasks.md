## 1. Deployment model and persisted settings

- [x] 1.1 Add the typed five-service catalog and local/remote/disabled dependency resolver; reject empty or unresolved selections with actionable errors.
- [x] 1.2 Extend the environment schema with versioned selection, dependency modes, consumed connection fields, optional service-interface ports, and selected-only validation.
- [x] 1.3 Treat legacy installations as the full local stack, preserve inactive settings and independent credentials, and reject malformed selection metadata.
- [x] 1.4 Separate container endpoints, agent/browser origins, and callback endpoints; derive local DNS/ports and preserve remote API prefixes.

## 2. English checkbox wizard

- [x] 2.1 Add service multiselect to the interaction boundary and Clack adapter, with English labels, keyboard help, fresh full selection, and saved selection.
- [x] 2.2 Collect only consumed dependency/service settings and explain remote requirements and disabled optional features.
- [x] 2.3 Ask for ports before local origins, derive fresh URL defaults, preserve saved addresses, and explain local/remote access.
- [x] 2.4 Show a redacted review of services, helpers, added/removed containers, disabled features, and loopback service interfaces; preserve existing state on cancellation before saving.

## 3. Configuration and integration boundaries

- [x] 3.1 Generate only the selected service configuration and data directories, preserving provider/model ownership and literal keys.
- [x] 3.2 Add the authenticated Knowledge service adapter using pinned route allowlists, existing token support, fixed upstream routing, and upload-compatible limits.
- [x] 3.3 Authenticate Knowledge completion/progress callbacks and Panel receivers; preserve creator context and synchronization, and reject mismatched Knowledge/Core pairing.
- [x] 3.4 Support disabled optional Knowledge and Panel integrations without unusable instructions/actions or changes to Core memory and authorization.
- [x] 3.5 Expose only explicitly enabled loopback service interfaces for remote Core, CLIProxyAPI, and Knowledge consumers, with authenticated and isolated routes.

## 4. Compose, images, and lifecycle

- [x] 4.1 Render one Compose project containing selected applications and required helpers with matching mounts, configuration, ports, and dependency edges.
- [x] 4.2 Accept required-image subsets and larger manifests while inspecting only locally required identities and retaining platform/archive integrity checks.
- [x] 4.3 Use the resolved readiness graph with explicit `--no-deps` orchestration, local Core initialization/reuse, and no bootstrap or repair mutation against remote Core.
- [x] 4.4 Check remote authentication/connectivity from the consuming network; offer explicit staged startup for unavailable configured peers while keeping pending integrations unavailable and rejecting invalid credentials.
- [x] 4.5 Persist non-secret applied service inventory; reconcile reviewed removals within the project, retain data, preserve unrelated/remote services, and maintain one local OAuth refresher.

## 5. Delivery

- [x] 5.1 Deliver affected images with immutable identities and an independently installable CLI package.
- [x] 5.2 Document checkbox purposes, local/VPS/split placement, service-interface/callback requirements, migration/rollback responsibilities, and actual engine/platform evidence; reconcile overlapping archived requirements.

## 6. Automatic image preparation

- [x] 6.1 Remove the manifest-path prompt; reuse valid local images and build missing images automatically, preserving previous image records for configuration snapshots and ending navigation before side effects.

## 7. Save and apply the remembered installation

- [x] 7.1 Save configuration before offering application with Yes selected; retain desired settings on No/failure and prior applied snapshots; expose reusable application with transient administrator credentials and current-environment regeneration.
- [x] 7.2 Remember the installation location and route `ams apply server` without path arguments or repeated setup questions, independently of the current directory.
- [x] 7.3 Document save-only and immediate/deferred application, secret handling, and cancellation boundaries in English.

## 8. Compose provider availability

- [x] 8.1 Check the saved Compose provider before administrator prompts and image preparation; report provider-specific errors, reuse a successful result, and stop before builds or running-service changes on failure.

## 9. Acceptance

- [x] 9.1 Build the required images and start the Compose deployment: selected long-lived application/support containers run, and required initialization jobs exit successfully. Record the actual engine/platform and observed container outcomes; this criterion does not establish functional correctness or production readiness.

Evidence: the rebuilt Linux ARM64 images, local full-stack lifecycle, and standalone CLIProxyAPI startup are recorded in `VALIDATION.md`. This is historical local evidence, not a new deployment or exhaustive placement/functional acceptance.

## Deferred validation (outside this change)

Comprehensive functional validation is deferred until Supergateway and the remaining connection work are implemented. It includes real-provider and agent requests, streaming/cancellation/session behavior, model-visible memory and tool instructions, semantic extraction/recall and authorized sharing, Wiki ingestion/read, external Caddy access, and complete backup/restore with administrator, conversation, Wiki, and OAuth state. These scenarios are outside this archived change's acceptance checklist and are not claimed as passed.
