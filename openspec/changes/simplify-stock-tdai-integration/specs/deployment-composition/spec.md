## ADDED Requirements

### Requirement: Native Knowledge completion callbacks

Knowledge and Panel SHALL communicate using the selected TDAI revision's native connection settings and callback behavior. AMS SHALL NOT inject callback authentication, private identity endpoints, persistent integration UUIDs or deployment-pairing checks into either service. Documentation SHALL identify callback authentication as upstream behavior rather than an AMS guarantee.

#### Scenario: Complete a Knowledge operation
- **WHEN** stock Knowledge sends progress or completion to its configured stock Panel
- **THEN** the native callback handler determines the result without an AMS service-protocol dependency
- **AND** failures are reported without patching either application

### Requirement: Complete stock stack composition

Every installation SHALL prepare all six applications: Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP. Required AMS helpers SHALL be limited to configuration delivery, bootstrap and the external access boundary. Native service connections SHALL use the local Compose network by default; Panel SHALL connect directly to Knowledge. The removed `knowledge-service` proxy and private identity protocol SHALL not be required. Image checks SHALL cover all six application images and the shared runtime image. Public host listeners SHALL remain bound to loopback by default.

#### Scenario: Prepare the full stack
- **WHEN** a fresh installation is configured and applied
- **THEN** all six applications are included with their required helpers and native configuration mounts
- **AND** service selection or remote placement metadata does not change the composition

#### Scenario: Required image is missing
- **WHEN** an application or helper lacks a usable image
- **THEN** image preparation completes before service replacement or reports failure while preserving the running installation

### Requirement: Native process readiness and initialization

AMS SHALL order the complete local stack using native process health and one-shot completion. Core initialization or existing-administrator checks SHALL use stock APIs and preserve the current credential lifecycle. Readiness SHALL NOT depend on injected `/ams/identity` endpoints or pairing protocols. Process health, service authentication, account authorization and functional tool/model behavior SHALL be reported separately. Upstream errors SHALL remain visible without staged split-host behavior or code corrections.

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
