> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

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

### Requirement: User-owned reverse proxy and independent external URLs

Setup SHALL initialize local MemoryProxy and Panel origins and MCP connection metadata without asking for service addresses or ports. During initial startup, generated origins SHALL follow allocated ports through bind-conflict retries and SHALL be finalized after successful activation. Operator-supplied origins SHALL remain authoritative. Later port changes SHALL retain saved origins and report needed operator adjustments. Native origins SHALL be editable in overrides; AMS publication settings SHALL be editable in runtime .env. Caddy, DNS, TLS and firewall configuration SHALL remain operator-owned. Published listeners SHALL bind to loopback. AMS SHALL pass user-configured origins and provider bases through without a value-shape policy; native loaders and consumers determine their meaning. Accepting a custom API prefix SHALL NOT imply that AMS helper routes follow it.

#### Scenario: Fresh setup with custom ports
- **WHEN** Apply replaces a busy default port during initial startup
- **THEN** the generated origin uses the successful attempt's port
- **AND** an explicitly supplied origin remains unchanged

#### Scenario: Existing service URL with a changed port
- **WHEN** a saved service origin exists and its host port is reassigned after initial activation
- **THEN** the origin is preserved and the new upstream port is reported

#### Scenario: Operator publishes independent domains
- **WHEN** the operator exposes loopback listeners through their reverse proxy
- **THEN** the configured domains and native request paths remain operator-owned
- **AND** AMS does not configure certificates or open another host interface

#### Scenario: Caddy is not configured yet
- **WHEN** local processes are healthy but external origins are unreachable
- **THEN** process startup does not claim external connectivity or functional model success
