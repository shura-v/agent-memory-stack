## 1. Existing-container detection

- [x] 1.1 Add bounded read-only discovery through available current Docker/Podman endpoints; deliver exact per-engine AMS project grouping and complete application-service detection including stopped containers.
- [x] 1.2 Keep the initial menu visible and run detection after Configure stack is selected, before all configuration questions; deliver a successful early exit with .env guidance and an optional project-label-derived path, without reading credentials or changing containers/files.

- [x] 1.3 Keep explicit apply available and select the existing-state bootstrap check when all configured application containers exist in the exact saved project; deliver reconfiguration without an administrator prompt or repair, and retain the initial key flow otherwise.

- [x] 1.4 Add the selected CLIProxyAPI account provider, read-only matching-credential inspection, provider-specific no-browser login and post-login recheck; deliver explicit failure handling, preserved other-provider accounts/routing, and MemoryProxy (agent API) / Panel (web interface) labels.

- [x] 1.5 Add Apply configuration to the initial menu and standalone ams apply without a server argument; deliver shared saved-target application, Configure stack as the default, and existing-stack detection only for Configure stack.

## 2. Documentation and acceptance

- [x] 2.1 Document the complete-stack heuristic, unavailable/partial runtime behavior, and operator responsibility; remove the superseded registration, locking, adoption, and Core-state-probing plan.
- [x] 2.2 Build required images and start the configured containers; record image identities, runtime/platform, running long-lived services, and successful required initialization jobs. This is the sole current-stage acceptance check; completed evidence is recorded in VALIDATION.md and artifacts/existing-stack-start.json.

Task 1.4 is subsequent provider work; its rebuilt runtime helper and selected-provider checks are recorded in VALIDATION.md. The completed full-stack build/start record in 2.2 applies to the earlier delivered state. Comprehensive functional validation, including a real Claude OAuth round trip, remains deferred. Specification scenarios describe required behavior rather than additional current-stage acceptance tasks.
