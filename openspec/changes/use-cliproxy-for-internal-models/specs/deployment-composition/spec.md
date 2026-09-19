## RENAMED Requirements

- FROM: `### Requirement: Apply a remembered target`
- TO: `### Requirement: Apply the fixed configuration`

## MODIFIED Requirements

### Requirement: Relevant questions and visible defaults

Interactive setup SHALL keep the initial menu visible. After the operator selects Configure stack, it SHALL perform the read-only complete-stack detection defined by host-installation. A detected complete stack SHALL exit the selected action with .env guidance before provider or other configuration questions. When no complete visible stack is detected, setup SHALL ask only for remaining interactive settings consumed by the deployment, including source-appropriate internal model settings: real endpoint/key for external mode, and model selection after account authorization for local CLIProxyAPI mode. It SHALL NOT ask for service selection, stack service origins, host ports, remote placement, service-interface enablement, configuration or data directories, or local Core/CLIProxyAPI service keys. It SHALL derive fresh local addresses, preserve saved overrides, automatically reuse or generate local service keys, and explain automatic ports and manual external-domain configuration. Advanced remote endpoints and credentials SHALL be provided through .env and SHALL NOT default to invented values.

#### Scenario: Choose an installation directory
- **WHEN** the operator chooses Configure stack and no complete visible stack is then detected
- **THEN** setup uses `homedir()/.agent-memory-stack` for `.env`, `compose.yaml`, and `.ams/` without asking for a directory
- **AND** the calling directory, `XDG_CONFIG_HOME`, and old `targets.json` files do not change that path

#### Scenario: Keep the data path without another question
- **WHEN** setup configures a fresh, partial, or deferred installation
- **THEN** it asks no configuration-directory or data-directory question
- **AND** `DATA_DIR` defaults to `./data` relative to the Compose configuration directory, preserves any saved value exactly, and remains manually editable in `.env`

#### Scenario: Change a local port during first setup
- **WHEN** apply replaces an unavailable preferred host port automatically
- **THEN** the corresponding generated local HTTP origin uses the resolved port without a port or URL prompt

#### Scenario: Restore an installation's choices
- **WHEN** no complete stack is detected and setup reads saved configuration from a partial or deferred installation
- **THEN** service selection, dependency choices, addresses, and local service keys are reused without prompting
- **AND** remaining interactive settings can be reviewed without revealing saved secrets

#### Scenario: Select Core without Knowledge
- **WHEN** an advanced saved configuration includes Core with Knowledge disabled and the guard permits setup
- **THEN** setup asks for Core's source-appropriate configuration and memory model, with local model selection deferred until account authorization
- **AND** it does not require a Knowledge model or Knowledge data configuration

#### Scenario: Existing complete stack
- **WHEN** all required application containers exist in one visible AMS project, including stopped containers
- **THEN** the menu remains visible until Configure stack is selected, then setup exits with .env guidance before any configuration question

#### Scenario: Internal source is not applicable
- **WHEN** neither Core nor Knowledge runs locally
- **THEN** setup asks no internal model source, provider or model questions

#### Scenario: External source is the only available route
- **WHEN** an internal consumer runs locally without local CLIProxyAPI
- **THEN** setup uses the external-provider questions and does not offer an unusable local source

#### Scenario: Change source before saving
- **WHEN** the operator navigates back and changes the internal source
- **THEN** dependent discovery and model-question state is recalculated for that source without rotating service keys or leaking secrets

### Requirement: Save before optional application

Setup SHALL save reviewed desired configuration before asking `Apply configuration now?`, with Yes selected initially. No SHALL exit successfully with `Configuration saved` and the corresponding later-apply command. Saving SHALL require no image preparation, running container engine, or administrator key. Saved desired settings SHALL survive failed or cancelled application. Cancellation before the save boundary SHALL preserve previous settings.

#### Scenario: Save server configuration without starting services
- **WHEN** the user selects No at immediate application
- **THEN** `.env`, the chosen provider, and the server setup location are saved
- **AND** no images are built, containers started, or administrator credentials requested

Explicit local internal mode SHALL permit saving desired settings with missing consumed model names marked as pending in the review. It SHALL NOT use fabricated model IDs. Those fields SHALL be required before application starts or recreates their consumers.

#### Scenario: Save before local model discovery
- **WHEN** the user selects local internal source and declines immediate application
- **THEN** source, service credentials, account provider and any existing model choices are saved without contacting an engine or model API
- **AND** missing local model choices are completed by the later apply workflow

### Requirement: Apply the fixed configuration

The CLI SHALL provide `ams apply` without a server or path argument or repeated configuration questions. The sole model-setup exception SHALL be completion of missing consumed model names in saved local internal mode after selected-provider authorization. The Apply configuration menu action SHALL invoke the same fixed-directory application workflow and SHALL NOT run the Configure stack detection guard. Configure, apply, update, and connection details SHALL use `homedir()/.agent-memory-stack` independently of the calling working directory and `XDG_CONFIG_HOME`, without a public directory argument or target-pointer file. Missing or invalid saved configuration SHALL fail with actionable guidance. Immediate and deferred application SHALL use the same implementation and read current saved settings. Old configuration, data, containers, and target-pointer files elsewhere SHALL NOT be migrated, deleted, or selected automatically. Changing a project path SHALL NOT imply a safe data or container migration.

After local Core becomes healthy, apply SHALL check for an active administrator through the existing bootstrap check. A successful check SHALL preserve the administrator and skip key generation and initialization regardless of application-container completeness. Only the explicit setup-required exit status SHALL invoke automatic key generation and the interactive handoff. Other check failures SHALL stop application without replacing credentials. Initial keys SHALL remain transient and SHALL NOT be persisted by setup. There SHALL be no manual administrator-key question.

#### Scenario: Apply edited server settings later
- **WHEN** the user edits saved .env and runs ams apply against initialized Core
- **THEN** apply regenerates derived configuration and recreates containers without requesting or replacing the administrator key
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

#### Scenario: Complete deferred model selection
- **WHEN** saved local internal settings lack one or both consumed model names
- **THEN** apply authorizes the selected local CLIProxyAPI account, lists its models from the consuming network, and asks only for the missing model choices
- **AND** it saves confirmed choices before starting or recreating Core and Knowledge

#### Scenario: Resume after authorization or one model choice
- **WHEN** application is interrupted after successful account authorization or saving one model choice
- **THEN** retry reuses that authorization and model and completes only outstanding work
- **AND** initialized Core identity and existing data remain intact

#### Scenario: Apply a fully selected local configuration
- **WHEN** the consumed model names are already validly configured
- **THEN** apply preserves them without model-selection prompts, even if discovery would omit them

#### Scenario: Missing local models in noninteractive apply
- **WHEN** apply has no interactive input and consumed local model names are missing
- **THEN** it reports the missing fields and how to complete them instead of waiting for input or inventing names

### Requirement: English documentation and build-and-start acceptance

All new UI text, explanations, errors, planning artifacts, and updated user documentation SHALL be in English. Documentation SHALL explain the automatic local setup, derived ports, and .env configuration for external domains, service interfaces, and advanced split-machine deployments. Acceptance for this stage SHALL be limited to building the required images and starting the selected containers. Comprehensive topology, agent, MCP, provider, memory/Wiki, and recovery validation SHALL follow Supergateway and the remaining integration work. Existing functional requirements and runtime checks SHALL remain in effect.

#### Scenario: Review the delivered setup experience
- **WHEN** an operator follows the English README for a documented topology
- **THEN** the wizard supplies the documented defaults and asks only the relevant questions
- **AND** the report states which runtime, platform, connectivity, and provider scenarios were actually tested

Documentation and architecture diagrams SHALL describe both shared CLIProxyAPI and independent external internal-model routes. The default shared route SHALL show Core and Knowledge reaching CLIProxyAPI directly while retaining separate model selection. The external route SHALL be explicitly labeled as an alternative. MemoryProxy model traffic and MCP Knowledge tools SHALL remain distinct. Interactive diagrams and the README/Pages overview image SHALL agree with their editable diagram specifications.

#### Scenario: Read the model routing diagrams
- **WHEN** the user opens the README overview image or published interactive maps
- **THEN** they can distinguish the default shared proxy from the optional external provider without interpreting both as simultaneous mandatory routes
- **AND** source links, generated diagrams and captions reflect the implemented behavior

## ADDED Requirements

### Requirement: Authorized local internal model preparation

For local internal mode, application SHALL prepare and authorize the selected CLIProxyAPI account before obtaining missing internal model choices or starting/recreating their consumers. It SHALL reuse the server-owned OAuth checks and preserve a single active token refresher. Model discovery SHALL run from a network that can reach the container-private API without publishing a new host port or exposing credentials in arguments or logs. Discovery SHALL be bounded to five seconds and offer manual input for unavailable or empty lists; authentication rejection SHALL identify the actual authorization failure.

#### Scenario: Model listing is unavailable
- **WHEN** the authorized local proxy's model list times out or returns no usable model names
- **THEN** missing Core and Knowledge model choices fall back to manual entry without fabricated defaults

#### Scenario: Authorization fails
- **WHEN** the local source cannot complete selected-provider authorization
- **THEN** application preserves saved desired configuration and the previous applied baseline and reports incomplete setup
- **AND** it does not start or recreate the internal consumers with invalid model settings

#### Scenario: Final applied state includes completed choices
- **WHEN** authorization, model selection and full application succeed
- **THEN** the applied-input baseline contains the final source, selected provider and both consumed model choices
- **AND** later rollback cannot restore an earlier incomplete selection
