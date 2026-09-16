# deployment-composition Specification

## Purpose

Let operators choose which Agent Memory Stack services run on each machine, with understandable defaults, explicit remote dependencies, and a reproducible Compose deployment that preserves existing data.

## Requirements

### Requirement: Explainable local service selection

Choosing Configure stack in `ams` SHALL enter stack setup without a service-selection question. A fresh installation SHALL configure the complete implemented local stack and its required support services, including MCP once its separate implementation is available. Existing explicit service selection and dependency modes SHALL remain authoritative. Advanced service selection SHALL remain editable through `.env`; setup SHALL display the resulting topology without asking the operator to choose services. Missing or invalid advanced settings SHALL produce actionable configuration guidance.

#### Scenario: Accept a complete local stack
- **WHEN** the operator configures a fresh installation
- **THEN** setup derives the full implemented local stack without displaying service checkboxes

#### Scenario: No local services selected
- **WHEN** an explicit saved selection is empty
- **THEN** setup reports an invalid AMS_SERVICES value to correct in .env without opening a checkbox prompt or changing running services

#### Scenario: Proceed directly to installation
- **WHEN** the operator chooses Configure stack
- **THEN** setup asks installation and provider questions without service-selection or local-action prompts
- **AND** local Core retains its administrator initialization flow and saved configuration remains applicable through the existing command

#### Scenario: Enable MCP with split dependencies
- **WHEN** an existing or manually edited configuration enables MCP with remote dependencies
- **THEN** setup reads its Core and protected Knowledge dependencies from configuration, resolves its port automatically during apply, and does not ask for topology, addresses, or ports
- **AND** missing required configuration prevents application with guidance to edit .env

#### Scenario: Preserve an existing installation
- **WHEN** setup reads an existing explicit service selection without MCP
- **THEN** it preserves that selection, identities, credentials, and preferred ports instead of enabling extra services

### Requirement: Previous-question navigation

Stack setup SHALL support Escape to return to the previous question and Ctrl+C to cancel. Revisiting a question SHALL restore its confirmed answer without revealing secret values. Changing an earlier answer SHALL invalidate subsequent answers and recalculate dependent questions. Generated credentials and model discovery results SHALL remain stable when navigating without changing their preceding inputs. Escape at the first question SHALL exit. Once configuration is saved, navigation SHALL NOT replay or undo persistence, installation, or connection-check effects.

#### Scenario: Correct an earlier service selection
- **WHEN** the operator presses Escape while answering a question in the simplified wizard
- **THEN** navigation returns to the preceding remaining question with its previous answer
- **AND** removed service, address, and port questions are not replayed

#### Scenario: Cancel administrator key handoff after saving
- **WHEN** the user cancels the administrator key handoff during immediate apply
- **THEN** desired configuration remains saved and no image preparation or installation occurs
- **AND** `ams apply` can retry without configuration questions

#### Scenario: Exit after installation starts
- **WHEN** the user presses Escape at an optional post-install prompt
- **THEN** the remaining prompt is cancelled without rerunning or rolling back installation

### Requirement: Explicit dependency resolution

Each configured service SHALL have every required dependency resolved to a local service or an explicitly configured remote service. Fresh setup SHALL derive local dependencies automatically. Existing or manually configured remote and disabled modes SHALL be preserved and validated without interactive placement or address questions. Setup SHALL explain missing configuration by field name, neither enabling unrequested services in existing installations nor inventing remote credentials.

#### Scenario: MemoryProxy uses remote services
- **WHEN** only MemoryProxy is selected locally
- **THEN** setup reads the Core and model-upstream connections it uses from .env
- **AND** Knowledge features require an explicit remote Knowledge connection or are disabled

#### Scenario: Standalone model proxy
- **WHEN** only CLIProxyAPI is selected
- **THEN** setup deploys CLIProxyAPI and its necessary support services
- **AND** it asks for no Core administrator, memory user, Z.ai model, Knowledge URL, or Panel URL

#### Scenario: Knowledge completion is handled on another machine
- **WHEN** Knowledge is selected locally and Panel is not selected locally
- **THEN** setup requires a remote Panel connection in .env for completion callbacks and Core entity synchronization
- **AND** it explains that polling alone does not complete this integration

#### Scenario: Required dependency is unresolved
- **WHEN** a selected service lacks a usable local or remote required dependency
- **THEN** setup identifies that dependency and stops before applying the configuration

### Requirement: Relevant questions and visible defaults

Interactive setup SHALL keep the initial menu visible. After the operator selects Configure stack, it SHALL perform the read-only complete-stack detection defined by host-installation. A detected complete stack SHALL exit the selected action with .env guidance before directory, provider, or other configuration questions. When no complete visible stack is detected, setup SHALL ask only for remaining interactive settings consumed by the deployment, including real LLM provider configuration and models. It SHALL NOT ask for service selection, stack service origins, host ports, remote placement, service-interface enablement, or local Core/CLIProxyAPI service keys. It SHALL derive fresh local addresses, preserve saved overrides, automatically reuse or generate local service keys, and explain automatic ports and manual external-domain configuration. Advanced remote endpoints and credentials SHALL be provided through .env and SHALL NOT default to invented values.

#### Scenario: Choose an installation directory
- **WHEN** the operator chooses Configure stack and no complete visible stack is then detected
- **THEN** the directory question suggests ./ams resolved from the current working directory unless a remembered target takes precedence

#### Scenario: Change a local port during first setup
- **WHEN** apply replaces an unavailable preferred host port automatically
- **THEN** the corresponding generated local HTTP origin uses the resolved port without a port or URL prompt

#### Scenario: Restore an installation's choices
- **WHEN** no complete stack is detected and setup reads saved configuration from a partial or deferred installation
- **THEN** service selection, dependency choices, addresses, and local service keys are reused without prompting
- **AND** remaining interactive settings can be reviewed without revealing saved secrets

#### Scenario: Select Core without Knowledge
- **WHEN** an advanced saved configuration includes Core with Knowledge disabled and the guard permits setup
- **THEN** setup asks for Core's provider configuration and memory model
- **AND** it does not require a Knowledge model or Knowledge data configuration

#### Scenario: Existing complete stack
- **WHEN** all required application containers exist in one visible AMS project, including stopped containers
- **THEN** the menu remains visible until Configure stack is selected, then setup exits with .env guidance before any configuration question

### Requirement: Distinct service and client connection addresses

The deployment SHALL distinguish addresses used by containers to contact dependencies from addresses advertised to agents, tools, and browsers. Selected local dependencies SHALL use their Compose network addresses. Remote dependencies SHALL use explicit reachable HTTP/HTTPS endpoints with the required API path and authentication. HTTPS certificate verification SHALL remain enabled. Client-facing origins SHALL exclude credentials, paths, queries, and fragments, with protocol paths appended exactly once.

#### Scenario: Split deployment across two machines
- **WHEN** a container consumes a dependency on another machine
- **THEN** its generated configuration uses the supplied remote service endpoint
- **AND** it does not use a Compose service name or loopback address belonging to a different machine

#### Scenario: Private Knowledge operations and public tools
- **WHEN** Panel uses a remote Knowledge service
- **THEN** setup reads the service connection required for Panel's operations separately from the protected tool origin advertised to agents
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

Every published host port SHALL remain explicitly bound to `127.0.0.1`. A service intended for remote consumers SHALL expose only the required authenticated service interface through a documented, explicitly enabled loopback port. Setup SHALL show the intended audience and resolved port mapping without asking whether to enable a service interface. Panel, MemoryProxy, and MCP SHALL publish their loopback entry points by default when implemented and configured locally. Core, CLIProxyAPI, direct Knowledge HTTP tools, and Knowledge service interfaces SHALL remain unpublished by default. Explicit advanced exposure SHALL require .env configuration; a legacy Knowledge port/origin alone SHALL NOT enable publication. It SHALL preserve user/tool authorization and SHALL NOT configure external listeners, reverse proxies, tunnels, DNS, TLS certificates, or firewall rules. Raw service interfaces SHALL NOT be mistaken for user-facing tool APIs.

#### Scenario: Connect a remotely consumed Core
- **WHEN** the operator enables Core's service interface for consumers on another machine
- **THEN** setup presents an authenticated loopback endpoint and the connection settings required by those consumers
- **AND** external reachability remains the operator's responsibility

#### Scenario: Ordinary complete local stack
- **WHEN** all services are local and no service interface is enabled for remote consumers
- **THEN** only Panel, MemoryProxy, and MCP publish host ports, without exposure questions
- **AND** Core, CLIProxyAPI, direct Knowledge HTTP tools, and raw Knowledge remain inside the Compose network
- **AND** MCP reaches the protected Knowledge tools gateway internally

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

The CLI SHALL provide `ams apply` without a server or path argument or repeated configuration questions. The Apply configuration menu action SHALL invoke the same saved-target application workflow and SHALL NOT run the Configure stack detection guard. It SHALL remember the absolute server installation location for the current OS user and use that location independently of the calling working directory. Missing or invalid saved configuration SHALL fail with actionable guidance. Immediate and deferred application SHALL use the same implementation and read current saved settings. The remembered target SHALL remain a convenience reference rather than an installation claim.

Before choosing the bootstrap mode for local Core, apply SHALL inspect application-container presence in the exact saved project and configured engine. When every configured application service has a container, including stopped containers, apply SHALL skip administrator questions and use the established existing-state bootstrap check without initialization or repair. Otherwise, local Core SHALL retain the initial generated/manual key and handoff flow. Required initial keys SHALL remain transient and SHALL NOT be persisted. Folder presence or applied inventory SHALL NOT select an existing-administrator-key prompt. Check failure SHALL NOT trigger fresh administrator creation or automatic recovery.

#### Scenario: Apply edited server settings later
- **WHEN** the user edits saved .env and runs ams apply with all configured application containers present
- **THEN** apply regenerates derived configuration and recreates containers using current settings without requesting an administrator key or reinitializing Core
- **AND** the existing-state bootstrap check runs, valid images are reused, and previous applied configuration remains available

#### Scenario: Apply deferred first installation
- **WHEN** saved configuration owns local Core and its configured application container set is incomplete
- **THEN** apply retains the initial generated/manual administrator-key and handoff flow
- **AND** it does not infer administrator state from folders or saved inventory

#### Scenario: Existing-state check fails
- **WHEN** a complete configured container group exists but its established bootstrap check fails
- **THEN** apply reports the failure and preserves the existing administrator credential without attempting initialization or repair

#### Scenario: Selected CLIProxyAPI account is already configured
- **WHEN** local CLIProxyAPI has a non-disabled saved authorization record matching CLIPROXY_AUTH_PROVIDER with an access or refresh credential
- **THEN** apply skips that provider's optional login question
- **AND** credentials or model listings from another provider do not satisfy the selected-provider check

#### Scenario: Selected account inspection fails
- **WHEN** runtime or authorization-file inspection fails
- **THEN** apply reports the failure instead of interpreting it as missing credentials or silently starting login

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

All new UI text, explanations, errors, planning artifacts, and updated user documentation SHALL be in English. Documentation SHALL explain the automatic local setup, derived ports, and .env configuration for external domains, service interfaces, and advanced split-machine deployments. Acceptance for this stage SHALL be limited to building the required images and starting the selected containers. Comprehensive topology, agent, MCP, provider, memory/Wiki, and recovery validation SHALL follow Supergateway and the remaining integration work. Existing functional requirements and runtime checks SHALL remain in effect.

#### Scenario: Review the delivered setup experience
- **WHEN** an operator follows the English README for a documented topology
- **THEN** the wizard supplies the documented defaults and asks only the relevant questions
- **AND** the report states which runtime, platform, connectivity, and provider scenarios were actually tested

### Requirement: Automatic host port allocation

Application SHALL prefer saved published ports or existing service defaults and automatically choose free alternatives when the selected Docker/Podman runtime cannot bind them. All published interfaces SHALL remain bound to 127.0.0.1. Allocation SHALL account for runtime-owned bindings, host listeners, duplicate choices, and the engine's actual publication context. Existing bindings owned by this installation's corresponding managed service SHALL be reused. Unrelated containers and listeners SHALL remain untouched. Only published interfaces SHALL receive host ports; the default allocation set is Panel, MemoryProxy, and MCP when implemented and local.

Chosen ports SHALL be persisted before generating dependent configuration and reported to the operator. Reapplication SHALL preserve available saved ports. Only generated local origins SHALL follow port changes; external domains, provider bases, and container-internal endpoints SHALL be preserved. Confirmed bind races SHALL trigger bounded allocation retries; unrelated engine errors SHALL fail explicitly. Temporary allocation resources SHALL be cleaned up without changing unrelated services.

#### Scenario: Preferred port is busy
- **WHEN** an unrelated container or host listener occupies the preferred published port
- **THEN** apply chooses an available loopback port in the selected runtime and records it without asking the operator
- **AND** the existing listener remains unchanged

#### Scenario: Existing installation already owns its port
- **WHEN** the same managed service already publishes the saved port under this installation's project identity
- **THEN** apply retains that binding instead of selecting a new port

#### Scenario: Engine differs from the CLI host
- **WHEN** the supported Docker/Podman setup uses a VM or selected engine connection
- **THEN** availability is determined through that runtime's real publication path rather than only the CLI host's socket namespace

#### Scenario: Save without applying
- **WHEN** the operator saves configuration and declines immediate apply
- **THEN** setup saves preferred settings without requiring an available engine or claiming that ports have been allocated

#### Scenario: Bind race or runtime failure
- **WHEN** service startup fails after allocation
- **THEN** only a confirmed port-binding conflict triggers a bounded reallocation attempt
- **AND** other failures identify their actual stage without being reported as port conflicts

#### Scenario: Preserve explicit external origin
- **WHEN** allocation changes a host port for a service with an operator-configured Caddy domain
- **THEN** its domain remains unchanged and output identifies the new proxy upstream port
