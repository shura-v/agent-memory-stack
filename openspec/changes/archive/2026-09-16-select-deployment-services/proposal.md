## Why

The wizard currently deploys a fixed stack and expects users to understand which services belong on each machine. Selecting services with explanations should make a complete local installation straightforward while also supporting a VPS or deployments split across machines.

## What Changes

- Enter stack setup directly when running `ams`, without an action menu. Add an early checkbox selection for Core, Knowledge, Panel, MemoryProxy, and CLIProxyAPI in Setup server, with concise English descriptions. A fresh installation initially selects all five; saved installations restore their selection.
- Generate one Compose project per installation on a machine from the selected services and their necessary support containers. Resolve dependencies locally or through explicitly configured remote endpoints; ask only for settings used by the resulting deployment.
- Offer local HTTP defaults and explain them in the wizard. Preserve saved values, distinguish container-to-container addresses from addresses used by agents or other machines, and verify remote dependencies from their actual calling environment.
- Persist and review deployment choices, including added and removed local services. Reconfiguration preserves data and credentials, stops only explicitly deselected services in the same project, and requires explicit dependency changes when moving a component.
- Update image preflight and documentation for all-local, server-only subsets, standalone CLIProxyAPI, and split deployments. Describe CLIProxyAPI as providing API access to supported AI providers; provider-login features remain those actually implemented.
- Prepare required images automatically after installation approval: reuse verified local image identities, build missing images from pinned sources, and manage the manifest internally without asking for its path.
- Save reviewed stack configuration before offering immediate application. Add `ams apply server`, using the remembered installation location, with transient credentials requested only during application. Declining immediate apply retains the saved configuration and exits successfully.

## Capabilities

### New Capabilities

- `deployment-composition`: explainable service selection, dependency resolution, conditional configuration, generated Compose, and safe per-machine lifecycle.

### Modified Capabilities

This archived change follows `containerize-agent-memory-stack` and supersedes its fixed five-service topology and all-six-images installation assumptions. Both changes are synchronized to the main spec store. Their acceptance is limited to building images and starting containers; comprehensive validation is deferred to the later integration phase.

## Impact

The implementation will affect `src/cli`, `src/setup`, `src/config`, `src/runtime/compose.ts`, image-manifest consumption in `src/build`, the Compose template, affected upstream integration patches, tests, and English documentation. It reuses the existing TypeScript/Clack package, prepared images, transient administrator handoff, application authorization, and explicit readiness stages.

Published host ports remain bound to `127.0.0.1`. Cross-machine communication requires operator-provided reachable routes, with service authentication; the wizard does not configure Caddy, DNS, TLS, firewalls, tunnels, or other hosts. This change plans placement and connections, not automatic data migration, arbitrary third-party Compose services, additional provider-login implementations, or publication/deployment to a real VPS.

## Acceptance scope

Build the required images and start the Compose deployment: selected long-lived application/support containers run, and required initialization jobs exit successfully. Record the actual engine/platform and observed container outcomes; this criterion does not establish functional correctness or production readiness.

Comprehensive functional validation is deferred until Supergateway and the remaining connection work are implemented. It includes real-provider and agent requests, streaming/cancellation/session behavior, model-visible memory and tool instructions, semantic extraction/recall and authorized sharing, Wiki ingestion/read, external Caddy access, and complete backup/restore with administrator, conversation, Wiki, and OAuth state. These scenarios are outside this archived change's acceptance checklist and are not claimed as passed.
