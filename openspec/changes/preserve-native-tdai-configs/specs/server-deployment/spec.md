> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

### Requirement: Installation-owned TDAI updates

`ams update tdai` SHALL use the same fixed runtime installation and associated native configuration root as `ams apply`, download the current `feat/server_team` commit, and prepare its revision, archive URL, and SHA-256 for `.ams/tdai-source.json`. Every TDAI version update SHALL stage all five exact native templates from that revision as defaults and compose them with byte-preserved overrides and deletion declarations. Document syntax, overlay/deletion structure, selected source integrity, input fingerprint checks, and required image verification SHALL precede active replacement. Activation SHALL record the matching source/image selection, defaults, overrides, deletion declarations, and root/origin reference together and perform the existing apply workflow. This command SHALL work from the installed npm package without a Git checkout or submodule and SHALL leave packaged sources and CLIProxyAPI selection unchanged.

#### Scenario: Update an existing installation
- **WHEN** the operator runs `ams update tdai` with saved valid full-stack configuration
- **THEN** source fetching, image fingerprints, and TDAI image revision labels use the installation's selected revision
- **AND** later `ams apply` invocations retain that revision until another update
- **AND** the settings snapshot preserves the previously applied source selection, defaults, overrides, deletion declarations, root/origin reference, and persistent secrets

#### Scenario: Source download fails
- **WHEN** GitHub commit resolution or archive download fails
- **THEN** the previous source selection remains unchanged and apply does not begin

#### Scenario: Effective configuration is incompatible with a new revision
- **WHEN** the new defaults and saved overrides cannot be composed due to document syntax, deletion or reference errors
- **THEN** update reports the file and setting requiring correction in overrides without disclosing secret values
- **AND** active native files, selected source and image identities, and running containers remain unchanged

#### Scenario: Upstream defaults change without a user override
- **WHEN** a native setting has no override and the new revision changes its default
- **THEN** the candidate adopts the new default while retaining unrelated overrides and existing secrets

#### Scenario: Upstream changes an overridden default
- **WHEN** the new template changes a default with an explicit override and the effective configuration remains valid
- **THEN** update retains the exact override and accepts the effective result
- **AND** all five defaults advance together without rewriting override files

### Requirement: Complete interactive server configuration

Interactive setup SHALL display the initial menu. After the operator chooses Configure stack, it SHALL check for a complete visible AMS container group before any configuration question. A detected complete stack SHALL produce native-configuration and orchestration .env guidance and a successful early exit without prompting for an administrator key or reading credentials. This short-circuit SHALL NOT inspect or classify Core initialization state. Explicit apply SHALL remain available with the Core-state-based bootstrap behavior defined by deployment-composition; the guard SHALL NOT remove that command or add administrator recovery.

When no complete stack is detected, setup SHALL ask for the internal model source for Core and Knowledge. It SHALL offer `Use this stack's CLIProxyAPI` and `Connect another model API`, selecting the first for a fresh installation. It SHALL ask for actual LLM endpoint/API key only for the external source, and separate memory and Knowledge models for both services. Both model questions SHALL occur during Configure stack. Apply SHALL consume saved model values without discovery, prompts or required-model enforcement. Setup SHALL also ask for the account provider for local CLIProxyAPI and remaining interactive operational settings. It SHALL retain `homedir()/.agent-memory-stack` for runtime orchestration and use the recorded XDG-based root for native service files, without a directory question. It SHALL manage `DATA_DIR` through `.env` without a data-directory question, defaulting to `./data` relative to the Compose configuration directory and preserving any saved value exactly. It SHALL derive fresh local topology, stack origins, and host ports without questions and preserve advanced .env configuration. CLIProxyAPI service keys SHALL be reused or generated automatically. Core server.apiKey SHALL remain an optional operator-owned native setting, without AMS generation or initial seeding. Existing secrets SHALL remain masked. The server .env SHALL remain the editable source for AMS orchestration settings. Setup SHALL copy all five exact templates into visible defaults/ under the configured XDG-based root and initially populate known installation values in partial native-format overrides/. Subsequent ordinary apply and update SHALL preserve override bytes; an explicit wizard operation SHALL change only reviewed fields and preserve unrelated values. Resolved published ports SHALL remain persisted orchestration settings. Initial allocation SHALL keep generated origins synchronized through retries and finalize them after successful activation; later port changes SHALL preserve explicit origins and report any required adjustment. Native and orchestration values SHALL pass through without AMS value-policy validation; actual service loading and runtime execution MAY fail.


#### Scenario: Configure Z.ai and ChatGPT
- **WHEN** the guard permits setup and the operator supplies a Z.ai endpoint, API key, and model names
- **THEN** Core and Knowledge use those settings for internal processing independently of the agent model
- **AND** CLIProxyAPI uses its server account authorization and internal API credential, without requiring a fabricated ChatGPT API key or provider URL

#### Scenario: Repeat setup
- **WHEN** the operator chooses Configure stack and setup finds all six application containers in one visible AMS project
- **THEN** it directs the operator to the native configuration root and orchestration .env and exits before configuration or administrator questions
- **AND** configuration, credentials, and container state remain unchanged

#### Scenario: Apply new configuration with older images
- **WHEN** the saved runtime or application image was built from different package inputs or lacks build provenance
- **THEN** application rebuilds the required outdated image before stopping services or activating new native configuration
- **AND** identical current images loaded from a bundle remain reusable without downloading source archives

#### Scenario: Partial or deferred installation
- **WHEN** the container check finds no complete stack and setup reads saved settings
- **THEN** the ordinary wizard preserves those settings and reports missing or invalid document syntax or integrity errors without revealing secrets

#### Scenario: Fresh shared model access
- **WHEN** a fresh full-stack installation accepts the local CLIProxyAPI source
- **THEN** setup derives internal API access without endpoint or key prompts
- **AND** it explains that Core and Knowledge model names are configured before saving, independently of apply-time account authorization

#### Scenario: Select the account before the internal model source
- **WHEN** the operator configures the full stack
- **THEN** it SHALL ask for the CLIProxyAPI account provider before `Models for memory and Knowledge`
- **AND** model selection remains part of Configure stack and account authorization remains part of apply
- **AND** local Core model input shows only the selected account family: `Core memory model (Anthropic)` for Claude or `Core memory model (OpenAI)` for Codex

#### Scenario: Apply the account provider already selected in setup
- **WHEN** the user selects a CLIProxyAPI account provider and accepts `Apply configuration now?`, or later runs standalone apply
- **THEN** apply SHALL use the saved `CLIPROXY_AUTH_PROVIDER` without another provider-selection prompt
- **AND** matching saved authorization SHALL skip login, while missing authorization SHALL start login for that provider
- **AND** authorization belonging to another provider SHALL NOT skip the selected provider's login

### Requirement: Independent internal LLM routing

AMS SHALL deliver the effective Core/Knowledge LLM configuration without rewriting it on Panel startup. The selected stock TDAI revision SHALL determine its runtime behavior. Internal source SHALL be recorded as `INTERNAL_LLM_SOURCE=cliproxy|external`. In cliproxy mode, initial overrides SHALL configure Core and Knowledge with this installation's local CLIProxyAPI base and service key. In external mode, initial overrides SHALL use the operator-configured LLM base and key. Subsequent application SHALL compose each consumer's defaults and overrides and preserve its explicit endpoint, key, and model. Changing orchestration source or shared service key SHALL NOT silently rewrite native overrides or trigger semantic connection enforcement. Operators SHALL maintain working endpoint/key combinations; actual loading and runtime authentication MAY fail. Both modes SHALL retain separate memory and Knowledge models, independent of the model in agent requests. Provider-issued credentials SHALL retain their original contents. Retained inactive source metadata SHALL NOT override active effective settings. CLIProxyAPI SHALL remain local in both internal LLM modes. This mode SHALL NOT publish another host interface.

#### Scenario: Panel restart preserves Z.ai routing
- **WHEN** Panel restarts and a subsequent Wiki ingestion runs
- **THEN** AMS preserves the configured native endpoint and model inputs
- **AND** functional validation records whether the stock services use them as expected independently of the agent model

#### Scenario: Share access while keeping model choices separate
- **WHEN** local mode has authorized CLIProxyAPI, valid effective local API access, and different configured Core and Knowledge model names
- **THEN** both consumers target `http://cli-proxy-api:8317/v1` with the current CLIProxyAPI service key and their respective model names
- **AND** the agent model remains determined by its own request

#### Scenario: Rotate the shared service key
- **WHEN** an operator changes CLIPROXY_API_KEY and applies local mode
- **THEN** apply preserves each effective consumer connection without checking credential equality
- **AND** explicit reviewed configuration changes can update those override fields while ordinary apply preserves them

#### Scenario: Preserve independent native consumer edits
- **WHEN** an operator edits Core or Knowledge's model, endpoint, or credential override after initial setup
- **THEN** ordinary apply uses each consumer's own effective native values without restoring wizard answers or another consumer's settings
- **AND** AMS preserves the saved credential input while native loading determines its runtime interpretation

#### Scenario: Switch from local model access to native external connections
- **WHEN** the operator changes INTERNAL_LLM_SOURCE from cliproxy to external and provides endpoint and credential overrides for each active native consumer
- **THEN** apply passes those independent native connections through without validating them or consulting former wizard credentials or a private service-value seed
- **AND** subsequent apply preserves those values and the configured models

### Requirement: One server Compose with loopback entry points

The delivery SHALL provide one Compose project per installation, containing all six applications: MemoryCore, MemoryKnowledge, MemoryPanel, MemoryProxy, CLIProxyAPI and MCP, together with config, bootstrap and access support containers. Only Panel, MemoryProxy, and MCP SHALL publish host ports by default, all on `127.0.0.1` and without enablement questions. Core, CLIProxyAPI, direct Knowledge HTTP tools, and Knowledge raw service interface SHALL remain internal unless an advanced .env override explicitly enables native loopback exposure. MCP SHALL reach the protected Knowledge gateway over the Compose network. Raw Knowledge SHALL remain unpublished by default. Authentication on native service interfaces SHALL remain owned by the selected upstream service, including its limitations. The stack SHALL allow the outbound connections required for LLM calls and OAuth.

#### Scenario: Start the server stack
- **WHEN** the operator starts the configured server project with no optional service interfaces
- **THEN** all six application services and three support containers run in that project with explicit readiness dependencies
- **AND** only Panel, MemoryProxy, and MCP are published on loopback without exposure prompts

#### Scenario: Reach the host from another machine
- **WHEN** another machine connects directly to a published stack port on the VPS network address
- **THEN** it cannot bypass the loopback boundary
- **AND** no wildcard IPv4 or IPv6 host binding is introduced

#### Scenario: Client is offline
- **WHEN** all services are on the server and the developer closes the agent or turns off the client computer
- **THEN** server services and internal LLM processing remain available
