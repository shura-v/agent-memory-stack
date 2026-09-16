## MODIFIED Requirements

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
