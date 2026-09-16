## Purpose

Let operators choose which Agent Memory Stack services run on each machine, with understandable defaults, explicit remote dependencies, and a reproducible Compose deployment that preserves existing data.

## ADDED Requirements

### Requirement: Explainable local service selection

Running `ams` SHALL enter stack setup directly without an action menu. Setup SHALL present an early checkbox selection for Core, Knowledge, Panel, MemoryProxy, and CLIProxyAPI before asking service-specific questions. Each choice SHALL include an English explanation of its purpose. Support containers SHALL be derived automatically. A fresh installation SHALL initially select all five services; an existing installation SHALL restore its saved selection. The wizard SHALL describe the selection as services to run on this machine, independent of whether it is a VPS or a developer computer.

#### Scenario: Accept a complete local stack
- **WHEN** the user accepts the fresh selection
- **THEN** all five application services are selected for one local Compose project
- **AND** the wizard explains the keyboard controls and local defaults in English

#### Scenario: No local services selected
- **WHEN** the user clears every application checkbox
- **THEN** setup asks them to select at least one service
- **AND** no installation files or running services are changed

#### Scenario: Proceed directly to installation
- **WHEN** the user confirms a nonempty service selection
- **THEN** setup continues to installation settings without a local action menu
- **AND** selected local Core uses the administrator initialization flow, while selections without Core skip administrator questions
- **AND** saved configuration can be applied through the named CLI commands without reopening setup questions

### Requirement: Previous-question navigation

Stack setup SHALL support Escape to return to the previous question and Ctrl+C to cancel. Revisiting a question SHALL restore its confirmed answer without revealing secret values. Changing an earlier answer SHALL invalidate subsequent answers and recalculate dependent questions. Generated credentials and model discovery results SHALL remain stable when navigating without changing their preceding inputs. Escape at the first question SHALL exit. Once configuration is saved, navigation SHALL NOT replay or undo persistence, installation, or connection-check effects.

#### Scenario: Correct an earlier service selection
- **WHEN** the user presses Escape at the provider question
- **THEN** setup returns to the service checkboxes with their previous selection
- **AND** changing that selection recalculates the required settings before any installation writes

#### Scenario: Cancel administrator key handoff after saving
- **WHEN** the user cancels the administrator key handoff during immediate apply
- **THEN** desired configuration remains saved and no image preparation or installation occurs
- **AND** `ams apply server` can retry without configuration questions

#### Scenario: Exit after installation starts
- **WHEN** the user presses Escape at an optional post-install prompt
- **THEN** the remaining prompt is cancelled without rerunning or rolling back installation

### Requirement: Explicit dependency resolution

Each selected service SHALL have every required dependency resolved to a selected local service or an explicitly configured remote service. For an unselected optional dependency, setup SHALL offer to connect it remotely or disable its associated feature. It SHALL explain why each remote dependency is needed. Setup SHALL neither silently enable an unselected application service nor require an optional disabled service's settings.

#### Scenario: MemoryProxy uses remote services
- **WHEN** only MemoryProxy is selected locally
- **THEN** setup requires the Core and model-upstream connections it uses
- **AND** Knowledge features require an explicit remote Knowledge connection or are disabled

#### Scenario: Standalone model proxy
- **WHEN** only CLIProxyAPI is selected
- **THEN** setup deploys CLIProxyAPI and its necessary support services
- **AND** it asks for no Core administrator, memory user, Z.ai model, Knowledge URL, or Panel URL

#### Scenario: Knowledge completion is handled on another machine
- **WHEN** Knowledge is selected locally and Panel is not selected locally
- **THEN** setup requires a remote Panel connection for completion callbacks and Core entity synchronization
- **AND** it explains that polling alone does not complete this integration

#### Scenario: Required dependency is unresolved
- **WHEN** a selected service lacks a usable local or remote required dependency
- **THEN** setup identifies that dependency and stops before applying the configuration

### Requirement: Relevant questions and visible defaults

Setup SHALL ask only for settings consumed by the resolved deployment. Local connection addresses SHALL be derived automatically. Local client-facing HTTP origins SHALL be offered using the selected ports, with saved values taking precedence. Remote addresses and existing remote credentials SHALL be supplied explicitly and SHALL NOT default to localhost or newly generated secrets. Setup SHALL explain when to accept a local address and when to enter an address on another machine.

#### Scenario: Choose an installation directory
- **WHEN** the user starts setup without a remembered installation
- **THEN** the first question suggests `./ams` resolved from the current working directory
- **AND** a remembered installation path takes precedence on later runs

#### Scenario: Change a local port during first setup
- **WHEN** the user changes a service's local published port before accepting its origin
- **THEN** the suggested local HTTP origin uses the selected port

#### Scenario: Restore an installation's choices
- **WHEN** the user reopens setup for an existing deployment
- **THEN** its service selection, dependency choices, addresses, and settings are offered
- **AND** keeping saved secrets does not expose or rotate them

#### Scenario: Select Core without Knowledge
- **WHEN** Core is selected and Knowledge is disabled
- **THEN** setup asks for Core's provider configuration and memory model
- **AND** it does not require a Knowledge model or Knowledge data configuration

### Requirement: Distinct service and client connection addresses

The deployment SHALL distinguish addresses used by containers to contact dependencies from addresses advertised to agents, tools, and browsers. Selected local dependencies SHALL use their Compose network addresses. Remote dependencies SHALL use explicit reachable HTTP/HTTPS endpoints with the required API path and authentication. HTTPS certificate verification SHALL remain enabled. Client-facing origins SHALL exclude credentials, paths, queries, and fragments, with protocol paths appended exactly once.

#### Scenario: Split deployment across two machines
- **WHEN** a container consumes a dependency on another machine
- **THEN** its generated configuration uses the supplied remote service endpoint
- **AND** it does not use a Compose service name or loopback address belonging to a different machine

#### Scenario: Private Knowledge operations and public tools
- **WHEN** Panel uses a remote Knowledge service
- **THEN** setup obtains the service connection required for Panel's operations separately from the protected tool origin advertised to agents
- **AND** the public tool interface does not gain private administrative routes

### Requirement: Authenticated Knowledge completion callbacks

When Knowledge is enabled, its completion and progress callbacks SHALL reach the configured local or remote Panel using service authentication. Panel SHALL verify that authentication before processing either callback type. Completion SHALL preserve ready-entity synchronization into Core and the existing creator/asset context. The callback-owning Panel SHALL be paired with the same Knowledge backend and Core instance. Readiness checks SHALL detect a mismatched pairing using authenticated integration identity, not merely endpoint reachability. A running Knowledge process with a missing callback integration SHALL not be reported as fully ready for Wiki use.

#### Scenario: Complete a split-host Wiki operation
- **WHEN** Knowledge completes an operation initiated through a Panel on another machine
- **THEN** its authenticated callback reaches that Panel and the corresponding ready entity is synchronized into Core
- **AND** an unauthenticated callback cannot change progress or entity state

#### Scenario: Callback owner targets a different deployment
- **WHEN** the remote Panel endpoint is reachable but targets a different Knowledge backend or Core instance
- **THEN** integration verification rejects the pairing and Wiki operations remain unavailable
- **AND** no ready entity is written into the wrong Core instance

### Requirement: Operator-controlled cross-machine access

Every published host port SHALL remain explicitly bound to `127.0.0.1`. A service intended for remote consumers SHALL expose only the required authenticated service interface through a documented, explicitly enabled loopback port. Setup SHALL show the intended audience and port mapping. It SHALL preserve user/tool authorization and SHALL NOT configure external listeners, reverse proxies, tunnels, DNS, TLS certificates, or firewall rules. Raw service interfaces SHALL NOT be mistaken for user-facing tool APIs.

#### Scenario: Connect a remotely consumed Core
- **WHEN** the operator enables Core's service interface for consumers on another machine
- **THEN** setup presents an authenticated loopback endpoint and the connection settings required by those consumers
- **AND** external reachability remains the operator's responsibility

#### Scenario: Ordinary complete local stack
- **WHEN** all services are local and no service interface is enabled for remote consumers
- **THEN** only the selected user-facing interfaces are published
- **AND** Core, raw Knowledge, and CLIProxyAPI remain private to the Compose network

### Requirement: Deployment-specific Compose and image requirements

Setup SHALL generate one Compose project containing exactly the selected application services and necessary support services. Dependencies, health checks, configuration files, data mounts, and published ports SHALL match that deployment. Image preflight SHALL require valid content identities and compatible platforms only for images used locally. A supplied manifest containing additional images SHALL remain accepted without requiring those extra images in the local engine.

#### Scenario: Use a subset of prepared images
- **WHEN** the operator selects CLIProxyAPI and supplies its image and the required runtime image
- **THEN** preflight and startup succeed without installing Core, Knowledge, Panel, or MemoryProxy images

#### Scenario: Required image is missing
- **WHEN** a selected local service or required support service has no usable image
- **THEN** confirmed setup builds the missing required image before preflight, initialization, or service replacement
- **AND** build failure leaves runtime configuration and running application containers unchanged while retaining saved desired settings

### Requirement: Automatic image preparation

Setup SHALL manage image records internally without asking for a manifest path. After approval and administrator key handoff where applicable, it SHALL verify reusable local images and build missing required images from pinned sources for the actual selected engine architecture. It SHALL preserve content identity and platform validation, and reject malformed records explicitly. Back navigation SHALL end before preparation begins. Existing installed image records SHALL remain available to the configuration snapshot before replacement.

#### Scenario: First installation without image records
- **WHEN** the user confirms installation in a directory without an image manifest
- **THEN** setup builds the required application and helper images and continues through preflight and apply
- **AND** no separate build command or manifest-path input is required

#### Scenario: Selected Compose provider is unavailable
- **WHEN** application starts with an unavailable saved Compose provider
- **THEN** it reports how to configure that provider before administrator prompts or image builds
- **AND** it retains saved settings and leaves running services unchanged

#### Scenario: Reuse or extend prepared images
- **WHEN** image records exist for some or all required services
- **THEN** setup reuses identities verified in the selected engine and builds only missing required images
- **AND** unused recorded images are preserved without requiring them in the local engine

#### Scenario: Cancel before image preparation
- **WHEN** the user declines immediate application or cancels administrator key handoff
- **THEN** setup performs no image preparation or runtime configuration writes
- **AND** desired configuration saved before the apply choice remains available

### Requirement: Save before optional application

Setup SHALL save reviewed desired configuration before asking `Apply configuration now?`, with Yes selected initially. No SHALL exit successfully with `Configuration saved` and the corresponding later-apply command. Saving SHALL require no image preparation, running container engine, or administrator key. Saved desired settings SHALL survive failed or cancelled application. Cancellation before the save boundary SHALL preserve previous settings.

#### Scenario: Save server configuration without starting services
- **WHEN** the user selects No at immediate application
- **THEN** `.env`, the chosen provider, and the server setup location are saved
- **AND** no images are built, containers started, or administrator credentials requested

### Requirement: Apply a remembered target

The CLI SHALL provide `ams apply server` without a path argument or repeated configuration questions. It SHALL remember the absolute server installation location for the current OS user and use that location independently of the calling working directory. Missing or invalid saved configuration SHALL fail with actionable guidance. Immediate and deferred application SHALL use the same implementation and read current saved settings. Required administrator keys SHALL be requested transiently during application and SHALL NOT be persisted.

#### Scenario: Apply edited server settings later
- **WHEN** the user edits saved `.env` and runs `ams apply server`
- **THEN** apply regenerates derived configuration and recreates containers using current settings
- **AND** valid existing images are reused and previous applied configuration remains available for recovery

### Requirement: Placement-aware initialization and readiness

Startup SHALL order only local services and support jobs required by the resolved deployment. A deployment owning local Core SHALL perform its established initialization or existing-state check. When required peer configuration is complete but a peer is unavailable, setup SHALL offer an explicit staged start that reports the affected integration as pending and blocks its operations until verification succeeds. Missing configuration or rejected credentials SHALL not qualify for this exception. Consumers of remote Core SHALL verify authorization and readiness without creating or repairing remote users, teams, or agents. Remote connection checks SHALL run from the environment that will consume them. Health, authorization, provider login, and semantic memory SHALL be reported as separate results.

#### Scenario: Remote Core is unavailable or unauthorized
- **WHEN** a required remote Core check fails
- **THEN** setup reports the failing connection without changing remote application state or exposing credentials
- **AND** it does not claim that the deployment is ready

#### Scenario: Bring up a fresh split Knowledge and Panel installation
- **WHEN** both machines have complete connection settings but the opposite peer has not started yet
- **THEN** the operator can explicitly start each local deployment with Wiki integration marked pending
- **AND** rerunning verification after both start checks forward and callback paths and pairing before enabling Wiki operations

#### Scenario: CLIProxyAPI account login
- **WHEN** the operator starts an implemented provider-login flow for selected local CLIProxyAPI
- **THEN** login runs on that machine and preserves one active token refresher
- **AND** a remote CLIProxyAPI connection is not presented as a local login target

### Requirement: Safe topology reconfiguration

The selected services and dependency modes SHALL persist as editable installation settings alongside the existing configuration. Before saving, setup SHALL show local additions, removals, remote connections, and disabled features with secrets redacted. Canceling before save SHALL leave configuration and containers unchanged; declining immediate application SHALL retain saved desired settings without changing running containers. Confirmed application SHALL stop and remove only deselected containers owned by that installation, preserve application data and reusable credentials, and update consumers. Deselection SHALL NOT delete volumes, migrate data, or operate another machine. Locally owned service keys SHALL be stored independently from credentials used for a remote replacement, so switching back can reuse the original local state.

#### Scenario: Move a service out of this installation
- **WHEN** the user deselects a local dependency and supplies its remote replacement
- **THEN** review identifies the local removal and the new remote connection
- **AND** after confirmation only this project's obsolete containers are removed and existing data remains available

#### Scenario: Re-enable a previous local service
- **WHEN** a service is selected again with its preserved data
- **THEN** setup reuses the existing state and credentials without reinitializing its identity

### Requirement: Existing installations remain usable

An installation created before service-selection metadata existed SHALL be interpreted as the existing complete local stack. Its current settings, identity, data paths, and service credentials SHALL be preserved. Conflicting or malformed selection settings SHALL fail with an actionable error instead of silently reverting to a default deployment.

#### Scenario: Upgrade the existing stack
- **WHEN** setup opens a pre-selection installation
- **THEN** all five application services are initially selected and its existing values are retained
- **AND** accepting the configuration keeps the same application identities and data

### Requirement: English documentation and build-and-start acceptance

All new UI text, explanations, errors, planning artifacts, and updated user documentation SHALL be in English. Documentation SHALL show complete local, VPS, and split-machine examples and explain each checkbox. Acceptance for this stage SHALL be limited to building the required images and starting the selected containers. Comprehensive topology, agent, MCP, provider, memory/Wiki, and recovery validation SHALL follow Supergateway and the remaining integration work. Existing functional requirements and runtime checks SHALL remain in effect.

#### Scenario: Review the delivered setup experience
- **WHEN** an operator follows the English README for a documented topology
- **THEN** the wizard supplies the documented defaults and asks only the relevant questions
- **AND** the report states which runtime, platform, connectivity, and provider scenarios were actually tested
