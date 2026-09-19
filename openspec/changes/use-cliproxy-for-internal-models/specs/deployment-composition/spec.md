> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

### Requirement: Relevant questions and visible defaults

Interactive setup SHALL keep the initial menu visible. After the operator selects Configure stack, it SHALL perform the read-only complete-stack detection defined by host-installation. A detected complete stack SHALL exit the selected action with native-configuration and orchestration .env guidance before provider or other configuration questions. When no complete visible stack is detected, setup SHALL ask only for remaining interactive settings consumed by the deployment, including source-appropriate internal model settings: real endpoint/key for external mode, and model entry during Configure stack for local CLIProxyAPI mode. It SHALL NOT ask for service selection, stack service origins, host ports, remote placement, service-interface enablement, configuration or data directories, or local Core/CLIProxyAPI service keys. It SHALL derive fresh local addresses, preserve saved overrides, automatically reuse or generate the CLIProxyAPI service key while leaving Core server.apiKey to native configuration, and explain automatic ports and manual external-domain configuration. Every installation SHALL contain all six local application services. Host publication SHALL remain in orchestration .env; native model endpoints and credentials SHALL remain in their owning overrides. External model APIs SHALL remain supported independently of stack placement.

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
- **THEN** the corresponding automatically generated local origin follows the resolved port through retries and is finalized after successful activation without a port or URL prompt
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

Setup SHALL save reviewed orchestration settings, operator-owned defaults, persistent overrides, deletion declarations, and the runtime root/origin reference before asking `Apply configuration now?`, with Yes selected initially. No SHALL exit successfully with `Configuration saved` and the corresponding later-apply command. Saving SHALL require no image preparation, running container engine, or Core administrator login key. Saved desired settings SHALL survive failed or cancelled application. Cancellation before the save boundary SHALL preserve previous settings.

#### Scenario: Save server configuration without starting services
- **WHEN** the user selects No at immediate application
- **THEN** orchestration `.env`, operator-owned defaults, persistent overrides, deletion declarations, the chosen provider, and the runtime root/origin reference are saved
- **AND** no images are built, containers started, or administrator credentials requested

Configure stack SHALL collect the model names for both internal consumers and persist their reviewed values. It SHALL NOT apply configured-value validators or invent model IDs. Apply SHALL use saved values without checking whether model fields are filled.

#### Scenario: Save local model choices without an engine
- **WHEN** the user selects local internal source and declines immediate application
- **THEN** source, service credentials, account provider and configured model choices are saved without contacting an engine or model API
- **AND** later apply reads these files without model discovery or questions

### Requirement: Apply the fixed configuration

The CLI SHALL provide `ams apply` without a server or path argument or repeated configuration questions. Apply SHALL NOT discover models, request model choices, validate configured model values or replace them. The Apply configuration menu action SHALL invoke the same fixed-directory application workflow and SHALL NOT run the Configure stack detection guard. Configure, apply, update, and connection details SHALL use `homedir()/.agent-memory-stack` for runtime orchestration independently of the calling working directory and `XDG_CONFIG_HOME`, without a public directory argument or target-pointer file. They SHALL use the saved native root reference or, when that reference is missing, complete composable sets at the selected native root with finalized operator-owned origins, without changing runtime identity or data paths. Missing configuration, invalid document syntax or an invalid reference SHALL fail with actionable guidance. `.ams-state.json` and additional fields in native reference or backup JSON SHALL be ignored. Immediate and deferred application SHALL use the same implementation and read current saved settings. Other configuration roots, data, containers, and target-pointer files SHALL NOT be adopted or changed automatically.

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

### Requirement: English documentation and build-and-start acceptance

New UI text, errors, planning artifacts and updated operator documentation SHALL be in English. Documentation SHALL describe the fixed full stack, native defaults/overrides, automatic ports, optional loopback publication and external versus local internal LLM routing. It SHALL NOT advertise partial or split-machine deployments. Acceptance SHALL identify the exact complete image set, runtime, platform and tested full-stack startup paths. Process startup SHALL remain distinct from real OAuth, provider inference, agent behavior and semantic memory/Wiki validation.

#### Scenario: Review the delivered setup experience
- **WHEN** acceptance is recorded
- **THEN** it identifies checks run against the current six-service contract and explicitly separates unrun provider and semantic checks
- **AND** earlier partial-deployment evidence is not counted as current acceptance
