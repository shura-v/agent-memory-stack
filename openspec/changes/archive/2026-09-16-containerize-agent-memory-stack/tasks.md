## 1. npm package and modular TypeScript

- [x] 1.1 Prepare strict TypeScript/ESM modules for CLI, interaction, setup, configuration, runtime, and image delivery; replace duplicate draft JavaScript implementations.
- [x] 1.2 Package `agent-memory-stack` with the `ams` executable, compile/pack scripts, and explicit distributable assets that resolve without a source checkout.
- [x] 1.3 Pin the selected stable `@clack/prompts` version and lockfile; expose stack setup through the replaceable interaction boundary.
- [x] 1.4 Collect consumed settings with defaults, masked secret input, existing-value preservation, redacted review/errors, and cancellation before persistence or deployment.
- [x] 1.5 Exclude real environment files, OAuth, application data, generated secrets, and build caches from Git, npm archives, and container build contexts.

## 2. Stack setup and configuration

- [x] 2.1 Define the editable server environment contract for service origins, loopback ports, data paths, real LLM endpoints/keys, separate models, and operational settings.
- [x] 2.2 Generate independent stable Core and CLIProxyAPI service keys; write environment and derived service configuration safely, preserving literal secret values.
- [x] 2.3 Accept or generate the administrator key, display the key before initialization, and pass them through transient stdin without a separate persisted copy.
- [x] 2.4 Separate initial administrator/default team/agent initialization from ordinary startup; preserve existing identity and data, and require matching credentials for authenticated repair.
- [x] 2.5 Configure Core and Knowledge with the supplied provider settings and separate models; disable Panel binding synchronization so it cannot replace the selected routing.

## 3. Images and one Compose project

- [x] 3.1 Pin upstream revisions, archive hashes, licenses, dependency locks, and base-image identities; reject source/platform integrity mismatches.
- [x] 3.2 Provide separate Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI, and support/runtime images with direct entrypoints and recorded output identities/platforms.
- [x] 3.3 Define one Compose project with required initialization/access services and ordered startup; bind exposed services to loopback and leave Caddy/ACME to the operator.
- [x] 3.4 Configure persistent data, mounts, and ownership for Core metadata/memory, Knowledge, Panel, Proxy, and CLIProxyAPI OAuth.
- [x] 3.5 Implement server-side device-code login and document operator-managed Caddy routing, including required paths and streaming behavior.

## 4. Authenticated agent requests and memory tools

- [x] 4.1 Implement the Knowledge access adapter using existing Core authentication, asset permissions, and membership contracts, including fail-closed behavior.
- [x] 4.2 Maintain pinned upstream patches for Core Bearer authentication, session ownership/ACL, external tool URLs, literal `AMS_USER_KEY`, Codex instructions, and restricted service routes.
- [x] 4.3 Remove sample model pricing restrictions and credit reporting; explicitly disable rate limiting without an enforcing backend.

## 5. Delivery

- [x] 5.1 Provide the documented npm archive and separate image/manifest delivery paths with identity-preserving load support; publication remains separately authorized.
- [x] 5.2 Document stack setup, manual agent connection parameters, initial key handoff, environment application, device login, diagnostics, and consistent backup/recovery responsibilities.

## 6. Acceptance

- [x] 6.1 Build the required images and start the Compose deployment: selected long-lived application/support containers run, and required initialization jobs exit successfully. Record the actual engine/platform and observed container outcomes; this criterion does not establish functional correctness or production readiness.

Evidence: the local Linux ARM64 Podman image builds and full-stack lifecycle are recorded in `VALIDATION.md`. This is historical local evidence, not a new deployment or a functional acceptance claim.

## Deferred validation (outside this change)

Comprehensive functional validation is deferred until Supergateway and the remaining connection work are implemented. It includes real-provider and agent requests, streaming/cancellation/session behavior, model-visible memory and tool instructions, semantic extraction/recall and authorized sharing, Wiki ingestion/read, external Caddy access, and complete backup/restore with administrator, conversation, Wiki, and OAuth state. These scenarios are outside this archived change's acceptance checklist and are not claimed as passed.
