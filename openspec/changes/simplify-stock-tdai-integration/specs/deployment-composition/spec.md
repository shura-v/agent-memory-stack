> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## ADDED Requirements

### Requirement: Native Knowledge completion callbacks

Knowledge and Panel SHALL communicate using the selected TDAI revision's native connection settings and callback behavior. AMS SHALL NOT inject callback authentication, private identity endpoints, persistent integration UUIDs or deployment-pairing checks into either service. Documentation SHALL identify callback authentication as upstream behavior rather than an AMS guarantee.

#### Scenario: Complete a Knowledge operation
- **WHEN** stock Knowledge sends progress or completion to its configured stock Panel
- **THEN** the native callback handler determines the result without an AMS service-protocol dependency
- **AND** failures are reported without patching either application

### Requirement: Complete stock stack composition

Every installation SHALL prepare all six applications: Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP. Required AMS helpers SHALL be limited to configuration delivery, bootstrap and the external access boundary. Native service connections SHALL use the local Compose network by default; Panel SHALL connect directly to Knowledge. The removed `knowledge-service` proxy and private identity protocol SHALL not be required.

Setup SHALL generate one Compose project containing all six application services (Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP) and all three support containers (config, bootstrap and access). Dependencies, health checks, configuration files, data mounts, and published ports SHALL match that deployment. All TDAI services SHALL consume the effective configuration composed from defaults and overrides through read-only mounts or an equivalent faithful runtime copy and their native file/env interfaces. Runtime adaptation SHALL preserve native options and literal secrets; generated environment transport SHALL derive only from effective native values and SHALL NOT become a third independent configuration set. Image preparation, preflight, export and import SHALL require the complete seven-image set: the six application images and the shared runtime image. Export and import SHALL reject incomplete manifests before engine operations. Setup MAY use incomplete local build records while preparing missing images, but SHALL produce and validate a complete manifest before preflight or configuration activation. Matching images SHALL remain reusable; only missing or outdated images SHALL require rebuilding. Public host listeners SHALL remain bound to loopback by default.

#### Scenario: Prepare the full stack
- **WHEN** a fresh installation is configured and applied
- **THEN** all six applications are included with their required helpers and native configuration mounts
- **AND** service selection or remote placement metadata does not change the composition

#### Scenario: Required image is missing
- **WHEN** an application or helper lacks a usable image
- **THEN** image preparation completes before service replacement or reports failure while preserving the running installation

#### Scenario: Apply an additional native option
- **WHEN** the operator adds a supported upstream setting that is absent from the AMS wizard
- **THEN** the service receives that setting without AMS dropping it or requiring an AMS schema extension

### Requirement: Native process readiness and initialization

AMS SHALL order the complete local stack using native process health and one-shot completion. Core initialization or existing-administrator checks SHALL use stock APIs and preserve the current credential lifecycle. Readiness SHALL NOT depend on injected `/ams/identity` endpoints or pairing protocols. Process health, service authentication, account authorization and functional tool/model behavior SHALL be reported separately. After process startup in either internal-model mode, Apply SHALL inspect the selected CLIProxyAPI account and offer its login flow when credentials are missing; this SHALL not discover or choose models. Upstream errors SHALL remain visible without staged split-host behavior or code corrections.

#### Scenario: Healthy stock processes
- **WHEN** the native services become healthy and required initialization completes
- **THEN** AMS reports process startup success without contacting an AMS-only TDAI endpoint
- **AND** it does not infer successful model requests or callbacks from health alone

#### Scenario: Native operation fails after startup
- **WHEN** a healthy stock service rejects an operation because of configuration or an upstream defect
- **THEN** AMS records that operation as failed without changing TDAI or claiming complete integration success

## REMOVED Requirements

### Requirement: Authenticated Knowledge completion callbacks

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Native Knowledge completion callbacks". No development-format migration is provided; native behavior and the external AMS boundary are described separately.

### Requirement: Deployment-specific Compose and image requirements

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Complete stock stack composition". No development-format migration is provided; native behavior and the external AMS boundary are described separately.

### Requirement: Placement-aware initialization and readiness

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Native process readiness and initialization". No development-format migration is provided; native behavior and the external AMS boundary are described separately.
