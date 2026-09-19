## MODIFIED Requirements

### Requirement: Relevant questions and visible defaults

Interactive setup SHALL keep the initial menu visible. After the operator selects Configure stack, it SHALL perform the read-only complete-stack detection defined by host-installation. A detected complete stack SHALL exit the selected action with native-configuration and orchestration .env guidance before provider or other configuration questions. When no complete visible stack is detected, setup SHALL ask only for remaining interactive settings consumed by the deployment, including source-appropriate internal model settings: real endpoint/key for external mode, and model entry during Configure stack for local CLIProxyAPI mode. It SHALL NOT ask for service selection, stack service origins, host ports, remote placement, service-interface enablement, configuration or data directories, or local Core/CLIProxyAPI service keys. It SHALL derive fresh local addresses, preserve saved overrides, automatically reuse or generate local service keys, and explain automatic ports and manual external-domain configuration. Every installation SHALL contain all six local application services. Host publication SHALL remain in orchestration .env; native model endpoints and credentials SHALL remain in their owning overrides. External model APIs SHALL remain supported independently of stack placement.

#### Scenario: Choose an installation directory
- **WHEN** the operator chooses Configure stack and no complete visible stack is then detected
- **THEN** setup retains `homedir()/.agent-memory-stack` for orchestration `.env`, `compose.yaml`, and `.ams/` without asking for a directory, and records the separate XDG-based native configuration root
- **AND** the calling directory, `XDG_CONFIG_HOME`, and old `targets.json` files do not change the runtime path; XDG selects only an uninitialized native configuration root

#### Scenario: Keep the data path without another question
- **WHEN** setup configures a fresh, interrupted, or deferred installation
- **THEN** it asks no configuration-directory or data-directory question
- **AND** `DATA_DIR` defaults to `./data` relative to the Compose configuration directory, preserves any saved value exactly, and remains manually editable in `.env`

#### Scenario: Change a local port during first setup
- **WHEN** apply replaces an unavailable preferred host port automatically
- **THEN** the corresponding missing or unset derived local origin override is finalized with the resolved port without a port or URL prompt
- **AND** an already explicit origin is preserved

#### Scenario: Restore an installation's choices
- **WHEN** no complete stack is detected and setup reads saved configuration from an interrupted or deferred installation
- **THEN** native overrides, addresses, and local service keys are reused without prompting
- **AND** remaining interactive settings can be reviewed without revealing saved secrets

#### Scenario: Existing complete stack
- **WHEN** all required application containers exist in one visible AMS project, including stopped containers
- **THEN** the menu remains visible until Configure stack is selected, then setup exits with native-configuration and orchestration .env guidance before any configuration question

#### Scenario: Change source before saving
- **WHEN** the operator navigates back and changes the internal source
- **THEN** dependent discovery and model-question state is recalculated for that source without rotating service keys or leaking secrets

#### Scenario: Select Core without Knowledge
- **WHEN** orchestration settings attempt to select Core while disabling Knowledge
- **THEN** these settings do not select a partial stack
- **AND** the supported wizard configures both consumers and preserves their independent model choices


### Requirement: Save before optional application

Setup SHALL save reviewed orchestration settings, exact defaults, persistent overrides, deletion declarations, template provenance, and the reference between their roots before asking `Apply configuration now?`, with Yes selected initially. No SHALL exit successfully with `Configuration saved` and the corresponding later-apply command. Saving SHALL require no image preparation, running container engine, or Core administrator login key. Saved desired settings SHALL survive failed or cancelled application. Cancellation before the save boundary SHALL preserve previous settings.

#### Scenario: Save server configuration without starting services
- **WHEN** the user selects No at immediate application
- **THEN** orchestration `.env`, exact defaults, persistent overrides, deletion declarations, template provenance, the chosen provider, and the associated configuration/runtime locations are saved
- **AND** no images are built, containers started, or administrator credentials requested

Configure stack SHALL collect the model names for both internal consumers and persist their reviewed values. It SHALL NOT apply configured-value validators or invent model IDs. Apply SHALL use saved values without checking whether model fields are filled.

#### Scenario: Save local model choices without an engine
- **WHEN** the user selects local internal source and declines immediate application
- **THEN** source, service credentials, account provider and configured model choices are saved without contacting an engine or model API
- **AND** later apply reads these files without model discovery or questions

### Requirement: Apply the fixed configuration

The CLI SHALL provide `ams apply` without a server or path argument or repeated configuration questions. Apply SHALL NOT discover models, request model choices, validate configured model values or replace them. The Apply configuration menu action SHALL invoke the same fixed-directory application workflow and SHALL NOT run the Configure stack detection guard. Configure, apply, update, and connection details SHALL use `homedir()/.agent-memory-stack` for runtime orchestration independently of the calling working directory and `XDG_CONFIG_HOME`, without a public directory argument or target-pointer file. They SHALL use the persisted association with the native configuration root without changing runtime identity or data paths. Missing configuration, invalid document syntax or inconsistent provenance SHALL fail with actionable guidance. Immediate and deferred application SHALL use the same implementation and read current saved settings. Other configuration roots, data, containers, and target-pointer files SHALL NOT be adopted or changed automatically.

After local Core becomes healthy, apply SHALL check for an active administrator through the existing bootstrap check. A successful check SHALL preserve the administrator and skip key generation and initialization regardless of application-container completeness. Only the explicit setup-required exit status SHALL invoke automatic key generation and the interactive handoff. Other check failures SHALL stop application without replacing credentials. Initial keys SHALL remain transient and SHALL NOT be persisted by setup. There SHALL be no manual administrator-key question.

#### Scenario: Apply edited server settings later
- **WHEN** the user edits saved overrides or orchestration .env and runs ams apply against initialized Core
- **THEN** apply composes defaults with current overrides, checks structural integrity and consumes the effective settings, preserves operator edits, and recreates affected containers without requesting or replacing the Core administrator key
- **AND** valid images are reused and previous applied configuration remains available

#### Scenario: Apply deferred first installation
- **WHEN** healthy local Core reports that initial setup is required
- **THEN** apply automatically generates a key and displays it with a single OK acknowledgement before administrator creation
- **AND** initialization receives that key only through stdin

#### Scenario: Resume a partial installation
- **WHEN** only part of the configured stack exists but Core already has an active administrator
- **THEN** apply starts the remaining services without key generation or administrator reinitialization

#### Scenario: Existing-state check fails
- **WHEN** the Core check fails for a reason other than its explicit setup-required status
- **THEN** apply reports the failure without generating a key or attempting initialization or repair

#### Scenario: Selected CLIProxyAPI account is already configured
- **WHEN** local CLIProxyAPI has a non-disabled saved authorization record matching CLIPROXY_AUTH_PROVIDER with an access or refresh credential
- **THEN** apply skips that provider's optional login question
- **AND** credentials or model listings from another provider do not satisfy the selected-provider check

#### Scenario: Selected account inspection fails
- **WHEN** runtime or authorization-file inspection fails
- **THEN** apply reports the failure instead of interpreting it as missing credentials or silently starting login

#### Scenario: Apply saved model configuration
- **WHEN** saved configuration supplies Core and Knowledge model values
- **THEN** apply passes them through without discovery, model questions or model-policy validation
- **AND** model edits are made through native overrides or Configure stack

#### Scenario: Empty model values during apply
- **WHEN** one or both model fields are empty, absent or changed after setup
- **THEN** interactive and noninteractive apply both read and apply the saved files without prompting for models or rejecting their values
- **AND** native loading and runtime execution determine the outcome

#### Scenario: Native value conflicts with changed topology
- **WHEN** an operator edits a native connection or path alongside orchestration settings
- **THEN** apply preserves and consumes those values without a semantic preflight policy; actual runtime checks determine whether the stack starts
- **AND** it does not silently restore the wizard's former value or replace the operator's value

### Requirement: Automatic host port allocation

Application SHALL prefer saved published ports or existing service defaults and automatically choose free alternatives when the selected Docker/Podman runtime cannot bind them. All published interfaces SHALL remain bound to 127.0.0.1. Allocation SHALL account for runtime-owned bindings, host listeners, duplicate choices, and the engine's actual publication context. Existing bindings owned by this installation's corresponding managed service SHALL be reused. Unrelated containers and listeners SHALL remain untouched. Only published interfaces SHALL receive host ports; the default allocation set is Panel, MemoryProxy, and MCP.

Chosen ports SHALL be persisted before generating dependent configuration and reported to the operator. Reapplication SHALL preserve available saved ports. First allocation SHALL finalize a missing or unset derived local origin override with the resolved port. Once configured, saved origin overrides SHALL remain explicit and unchanged on ordinary apply; later port changes SHALL report the new binding and any required origin adjustment, and actual service or runtime failures SHALL be reported without silently rewriting overrides. External domains, provider bases, and container-internal endpoints SHALL be preserved. No baseline comparison SHALL infer permission to rewrite an origin. Confirmed bind races SHALL trigger bounded allocation retries; unrelated engine errors SHALL fail explicitly. Temporary allocation resources SHALL be cleaned up without changing unrelated services.

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

#### Scenario: Change a port after initial origin configuration
- **WHEN** a later apply allocates a different host port and an origin override already exists
- **THEN** it preserves the origin and reports the new binding and any required adjustment
- **AND** a failing connection is reported during runtime execution and the operator can correct its override

### Requirement: Automatic image preparation

Setup SHALL manage complete seven-image records internally without asking for a manifest path. After approval it SHALL verify reusable local images and build missing or outdated images from pinned sources for the selected engine architecture. Content identity, platform and build provenance validation SHALL remain mandatory; malformed or incomplete imported records SHALL fail explicitly. Back navigation SHALL end before preparation. Existing installed image records SHALL remain available to the configuration snapshot before replacement.

#### Scenario: First installation without image records
- **WHEN** the user confirms installation without prepared images
- **THEN** setup prepares all six application images and the shared runtime image before full-stack preflight and apply
- **AND** no manifest-path input or separate build command is required

#### Scenario: Selected Compose provider is unavailable
- **WHEN** apply starts with an unavailable saved provider
- **THEN** it reports provider configuration guidance before image builds or administrator prompts and preserves saved settings

#### Scenario: Reuse or extend prepared images
- **WHEN** prepared images match the package inputs, source revision and selected engine
- **THEN** setup reuses them and builds only missing or outdated members of the full image set

#### Scenario: Cancel before image preparation
- **WHEN** the user declines immediate application
- **THEN** setup preserves desired configuration without image preparation or runtime effects

### Requirement: English documentation and build-and-start acceptance

New UI text, errors, planning artifacts and updated operator documentation SHALL be in English. Documentation SHALL describe the fixed full stack, native defaults/overrides, automatic ports, optional loopback publication and external versus local internal LLM routing. It SHALL NOT advertise partial or split-machine deployments. Acceptance SHALL identify the exact complete image set, runtime, platform and tested full-stack startup paths. Process startup SHALL remain distinct from real OAuth, provider inference, agent behavior and semantic memory/Wiki validation.

#### Scenario: Review the delivered setup experience
- **WHEN** acceptance is recorded
- **THEN** it identifies checks run against the current six-service contract and explicitly separates unrun provider and semantic checks
- **AND** earlier partial-deployment evidence is not counted as current acceptance

### Requirement: Operator-controlled cross-machine access

Every published host port SHALL remain explicitly bound to `127.0.0.1`. A service intended for remote consumers SHALL expose only the required authenticated service interface through a documented, explicitly enabled loopback port. Setup SHALL show the intended audience and resolved port mapping without asking whether to enable a service interface. Panel, MemoryProxy, and MCP SHALL publish their loopback entry points by default for every installation. Core, CLIProxyAPI, direct Knowledge HTTP tools, and Knowledge service interfaces SHALL remain unpublished by default. Explicit advanced exposure SHALL require .env configuration; a Knowledge port/origin alone SHALL NOT enable publication. It SHALL preserve user/tool authorization and SHALL NOT configure external listeners, reverse proxies, tunnels, DNS, TLS certificates, or firewall rules. Raw service interfaces SHALL NOT be mistaken for user-facing tool APIs.

#### Scenario: Connect a remotely consumed Core
- **WHEN** the operator enables Core's service interface for consumers on another machine
- **THEN** setup presents an authenticated loopback endpoint and the connection settings required by those consumers
- **AND** external reachability remains the operator's responsibility

#### Scenario: Ordinary complete local stack
- **WHEN** all services are local and no service interface is enabled for remote consumers
- **THEN** only Panel, MemoryProxy, and MCP publish host ports, without exposure questions
- **AND** Core, CLIProxyAPI, direct Knowledge HTTP tools, and raw Knowledge remain inside the Compose network
- **AND** MCP reaches the protected Knowledge tools gateway internally

## REMOVED Requirements

### Requirement: Existing installations remain usable
**Reason**: AMS has never been released. Supporting pre-selection or generated-file development formats is not part of the native configuration contract.
**Migration**: None. Initial setup creates native configuration; subsequent updates and recovery use complete native state.

### Requirement: Explainable local service selection
**Reason**: Replaced by Fixed complete local service composition; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

### Requirement: Deployment-specific Compose and image requirements
**Reason**: Replaced by Complete Compose and image requirements; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

### Requirement: Explicit dependency resolution
**Reason**: Replaced by Local stack dependency resolution; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

### Requirement: Distinct service and client connection addresses
**Reason**: Replaced by Local service and public client addresses; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

### Requirement: Authenticated Knowledge completion callbacks
**Reason**: Replaced by Authenticated local Knowledge completion callbacks; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

### Requirement: Placement-aware initialization and readiness
**Reason**: Replaced by Full-stack initialization and readiness; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

### Requirement: Safe topology reconfiguration
**Reason**: Replaced by Safe full-stack configuration changes; installations always use the complete local stack.
**Migration**: None. AMS has no released partial-deployment format to migrate; new setup and apply use the full-stack contract.

## ADDED Requirements

### Requirement: Fixed complete local service composition

Configure stack SHALL always configure Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP together with their four required support containers. Setup SHALL display this fixed composition without service-selection questions. Service selection, dependency placement and disabled-service modes SHALL NOT be configurable through orchestration settings. Removed service-selection and remote-placement fields SHALL NOT control deployment composition or trigger a conversion.

#### Scenario: Configure the complete local stack
- **WHEN** the operator configures a fresh installation or reapplies saved settings
- **THEN** all six application services and their support containers belong to one local Compose project
- **AND** setup offers both internal LLM source choices independently of service composition

#### Scenario: Reject removed deployment controls
- **WHEN** orchestration settings include AMS_SERVICES, AMS_DEPLOYMENT_VERSION, placement-mode or REMOTE_* fields
- **THEN** the installation retains its fixed complete local composition
- **AND** no migration, subset deployment or remote replacement is inferred

### Requirement: Complete Compose and image requirements

Setup SHALL generate one Compose project containing all six application services (Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP) and all four support containers (config, bootstrap, access and knowledge-service). Dependencies, health checks, configuration files, data mounts, and published ports SHALL match that deployment. All TDAI services SHALL consume the effective configuration composed from defaults and overrides through read-only mounts or an equivalent faithful runtime copy and their native file/env interfaces. Runtime adaptation SHALL preserve native options and literal secrets; generated environment transport SHALL derive only from effective native values and SHALL NOT become a third independent configuration set. Image preparation, preflight, export and import SHALL require the complete seven-image set: the six application images and the shared runtime image. Export and import SHALL reject incomplete manifests before engine operations. Setup MAY use incomplete local build records while preparing missing images, but SHALL produce and validate a complete manifest before preflight or configuration activation. Matching images SHALL remain reusable; only missing or outdated images SHALL require rebuilding.

#### Scenario: Required image is missing
- **WHEN** an application service or required support service has no usable image
- **THEN** confirmed setup builds the missing required image before preflight, initialization, or service replacement
- **AND** build failure leaves runtime configuration and running application containers unchanged while retaining saved desired settings

#### Scenario: Apply an additional native option
- **WHEN** the operator adds a supported upstream setting that is absent from the AMS wizard
- **THEN** the service receives that setting without AMS dropping it or requiring an AMS schema extension

### Requirement: Local stack dependency resolution

Initial setup SHALL populate known stack dependencies with local Compose addresses. Effective native documents SHALL own subsequent service endpoints and credentials; AMS SHALL preserve edited values without enforcing matching connections. Core and Knowledge SHALL retain separate model choices and MAY use a configured external model API when INTERNAL_LLM_SOURCE=external. External model routing SHALL NOT remove CLIProxyAPI or any other stack service.

#### Scenario: Resolve the local dependency graph
- **WHEN** a complete installation is configured
- **THEN** MemoryProxy, Panel, Knowledge and MCP use the installation's local Core and corresponding local service dependencies
- **AND** all native consumer documents are initialized and composed together

#### Scenario: Choose an external internal-model provider
- **WHEN** the operator selects external internal LLM routing
- **THEN** Core and Knowledge use their configured native model API connections while all six services remain local

#### Scenario: Required dependency configuration is invalid
- **WHEN** an edited native connection fails during actual service startup or authentication
- **THEN** apply reports the actual runtime failure and preserves coherent recovery information

### Requirement: Local service and public client addresses

The deployment SHALL distinguish Compose addresses used by containers from origins advertised to agents, tools and browsers. Initial stack dependencies SHALL use local Compose services. Operator-edited endpoints, API prefixes, credentials and public origins SHALL pass through without an AMS shape or equality check. Native transport and helper contracts SHALL determine how those values are used; accepting a custom prefix SHALL NOT imply automatic helper-route propagation.

#### Scenario: Container and browser use different addresses
- **WHEN** Panel or MemoryProxy is published through a user-managed reverse proxy
- **THEN** public guidance uses its configured origin while local service dependencies retain Compose addresses

#### Scenario: Separate private Knowledge operations from tools
- **WHEN** Panel performs Knowledge operations and an agent requests Knowledge tools
- **THEN** Panel uses the authenticated local service adapter and the agent uses MCP or the explicitly published protected tools gateway
- **AND** public tools do not expose private administrative routes

### Requirement: Authenticated local Knowledge completion callbacks

Knowledge completion and progress callbacks SHALL reach the local Panel using service authentication. Panel SHALL verify authentication before processing either callback type. Completion SHALL preserve ready-entity synchronization into local Core and the existing creator/asset context. Initial callback settings SHALL pair Knowledge, Panel and Core from the same installation; subsequent native changes SHALL remain operator-owned. A running Knowledge process with failed callback integration SHALL NOT be reported as fully ready for Wiki use.

#### Scenario: Complete a Wiki operation
- **WHEN** Knowledge completes an operation initiated through this installation's Panel
- **THEN** its authenticated callback reaches Panel and the corresponding ready entity is synchronized into Core
- **AND** an unauthenticated callback cannot change progress or entity state

#### Scenario: Callback authentication fails
- **WHEN** Knowledge cannot authenticate to its local Panel callback
- **THEN** readiness reports the failed integration and apply does not claim complete readiness

### Requirement: Full-stack initialization and readiness

Startup SHALL order the complete local stack and all required support jobs. Core SHALL perform its established initialization or existing-state check. In local internal-model mode, CLIProxyAPI authorization SHALL precede startup of Core and Knowledge consumers. Model questions SHALL remain exclusively in Configure stack. Required local readiness or integration failures SHALL fail apply; there SHALL be no remote-peer staged-start or allow-pending bypass. Process health, service authentication, provider login and semantic behavior SHALL remain distinct validation results.

#### Scenario: Required local integration fails
- **WHEN** a required local readiness or authenticated integration check fails
- **THEN** apply identifies the failed stage without exposing credentials or offering a staged-start bypass

#### Scenario: Authorize CLIProxyAPI before internal consumers
- **WHEN** shared internal models are configured and the selected provider lacks saved authorization
- **THEN** apply prepares CLIProxyAPI, completes provider authorization and consumes the saved model values, then starts the full stack
- **AND** the intermediate proxy startup is a resumable phase rather than a separately configurable deployment

### Requirement: Safe full-stack configuration changes

The installation's composition SHALL remain the complete local stack. Before saving, setup SHALL show its fixed services, required helpers, published interfaces and effective settings with secrets redacted. Cancellation before saving SHALL leave configuration and containers unchanged; declining application SHALL retain desired settings without changing running containers. Applying edited native overrides or orchestration settings SHALL preserve data and reusable credentials and recreate affected local containers. It SHALL NOT introduce service selection, remote replacements, data migration or operations on another machine.

#### Scenario: Review a configuration edit
- **WHEN** the operator changes a model, publication setting or native override
- **THEN** review retains the full local service composition and redacts secrets
- **AND** later apply preserves application identity, data and reusable keys

#### Scenario: Resume an interrupted full-stack installation
- **WHEN** only some expected containers exist after an interrupted apply
- **THEN** retry targets the complete stack and reuses initialized Core state without rotating its administrator
