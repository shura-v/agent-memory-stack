## MODIFIED Requirements

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

Setup SHALL ask only for remaining interactive settings consumed by the deployment, including real LLM provider configuration and models. It SHALL NOT ask for service selection, stack service origins, host ports, remote placement, or service-interface enablement. It SHALL derive fresh local addresses, preserve saved overrides, and explain automatic ports and manual external-domain configuration. Advanced remote endpoints and credentials SHALL be provided through .env and SHALL NOT default to invented values.

#### Scenario: Choose an installation directory
- **WHEN** the user starts setup without a remembered installation
- **THEN** the first question suggests `./ams` resolved from the current working directory
- **AND** a remembered installation path takes precedence on later runs

#### Scenario: Change a local port during first setup
- **WHEN** apply replaces an unavailable preferred host port automatically
- **THEN** the corresponding generated local HTTP origin uses the resolved port without a port or URL prompt

#### Scenario: Restore an installation's choices
- **WHEN** the user reopens setup for an existing deployment
- **THEN** its service selection, dependency choices, and addresses are reused without prompting
- **AND** retained interactive settings can be reviewed without exposing or rotating saved secrets

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
- **THEN** setup reads the service connection required for Panel's operations separately from the protected tool origin advertised to agents
- **AND** the public tool interface does not gain private administrative routes

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

### Requirement: English documentation and build-and-start acceptance

All new UI text, explanations, errors, planning artifacts, and updated user documentation SHALL be in English. Documentation SHALL explain the automatic local setup, derived ports, and .env configuration for external domains, service interfaces, and advanced split-machine deployments. Acceptance for this stage SHALL be limited to building the required images and starting the selected containers. Comprehensive topology, agent, MCP, provider, memory/Wiki, and recovery validation SHALL follow Supergateway and the remaining integration work. Existing functional requirements and runtime checks SHALL remain in effect.

#### Scenario: Review the delivered setup experience
- **WHEN** an operator follows the English README for a documented topology
- **THEN** the wizard supplies the documented defaults and asks only the relevant questions
- **AND** the report states which runtime, platform, connectivity, and provider scenarios were actually tested

## ADDED Requirements

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
