# server-deployment Specification

## Purpose

Deploy the complete local memory stack and model proxies in one Compose project per machine, with controlled initialization, loopback entry points, and processing independent of agent availability.

## Requirements

### Requirement: Installation-owned TDAI updates

`ams update tdai` SHALL use the same fixed runtime installation and associated native configuration root as `ams apply`, download the current `feat/server_team` commit, and prepare its revision, archive URL, and SHA-256 for `.ams/tdai-source.json`. Every TDAI version update SHALL stage all five exact native templates from that revision as defaults and compose them with byte-preserved overrides and deletion declarations. Document syntax, overlay/deletion, input fingerprint checks, source archive integrity, and required image verification SHALL precede active replacement. Activation SHALL record matching source/image selection, defaults and overrides together and perform the existing apply workflow. This command SHALL work from the installed npm package without a Git checkout or submodule and SHALL leave packaged sources and CLIProxyAPI selection unchanged.

#### Scenario: Update an existing installation
- **WHEN** the operator runs `ams update tdai` with saved valid full-stack configuration
- **THEN** source fetching, image fingerprints, and TDAI image revision labels use the installation's selected revision
- **AND** later `ams apply` invocations retain that revision until another update
- **AND** the settings snapshot preserves the previously applied source selection, defaults, overrides, deletion declarations, root reference, initial-origin state, and persistent secrets

#### Scenario: Source download fails
- **WHEN** GitHub commit resolution or archive download fails
- **THEN** the previous source selection remains unchanged and apply does not begin

#### Scenario: Effective configuration is incompatible with a new revision
- **WHEN** the new defaults and saved overrides cannot be composed due to document syntax or deletion errors
- **THEN** update reports the file and setting requiring correction in overrides without disclosing secret values
- **AND** active native files, selected source and image identities, and running containers remain unchanged

#### Scenario: Upstream defaults change without a user override
- **WHEN** a native setting has no override and the new revision changes its default
- **THEN** the candidate adopts the new default while retaining unrelated overrides and existing secrets

#### Scenario: Upstream changes an overridden default
- **WHEN** the new template changes a default with an explicit override and the effective configuration remains valid
- **THEN** update retains the exact override and accepts the effective result
- **AND** all five defaults advance together without rewriting override files

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

### Requirement: Transient initial administrator credential

When healthy local Core explicitly requires initial setup, Setup server SHALL generate an administrator key automatically without a generation or manual-entry question. Before administrator creation it SHALL show the resulting key in a dedicated interactive handoff with an opportunity to copy it or cancel setup. The key SHALL be passed to initialization through a transient channel and SHALL NOT be saved by the setup program in `.env`, `.admin-key`, generated files, command arguments, container environment or routine logs. Core's own credential database SHALL retain the created identity as required by its authentication model.

#### Scenario: Generated default key
- **WHEN** the operator confirms OK after the automatically generated key is displayed
- **THEN** bootstrap creates the administrator with exactly that key and verifies authentication, default team and default agent
- **AND** no extra copy of the bootstrap key is written to deployment files

#### Scenario: Existing administrator
- **WHEN** the Core check finds an active administrator
- **THEN** setup preserves its key and proceeds without generation or handoff

#### Scenario: Cancel before initialization
- **WHEN** the operator cancels the key handoff before confirming OK
- **THEN** no administrator is created and no generated admin key is persisted by setup

#### Scenario: Restart an initialized installation
- **WHEN** the configured server is restarted with existing administrator data
- **THEN** normal startup does not require the transient setup key and does not recreate or rotate the administrator

#### Scenario: Partial initialization or conflict
- **WHEN** the initialization attempt returns an existing-user conflict or incomplete default entities
- **THEN** setup verifies the supplied key before any authenticated repair and reports failure if it does not match
- **AND** existing data is preserved; a conflict alone is not treated as successful first-time initialization

### Requirement: Server-owned OAuth

CLIProxyAPI SHALL persist account authorization on the machine hosting its local container. Setup SHALL offer ChatGPT (Codex) and Claude account setup, saved as CLIPROXY_AUTH_PROVIDER=codex or claude with codex as the compatibility default. Existing installations SHALL be able to edit that value in .env and apply it. This selection SHALL affect account setup only, preserving model routing and authorization files for other providers.

Before offering login, application SHALL inspect local saved authorization with read-only file access and no network access. A matching record SHALL have the selected provider type, SHALL NOT be disabled, and SHALL contain an access or refresh credential. A different provider's credentials or a nonempty model list SHALL NOT satisfy this check. Inspection failures SHALL be reported as failures rather than missing authorization. Matching saved credentials SHALL skip optional login without claiming token freshness or successful inference.

ChatGPT (Codex) SHALL use no-browser device login. Claude SHALL use no-browser login with manual entry of the complete final localhost callback URL after browser sign-in; guidance SHALL explain the 15-second terminal prompt, possible browser connection-refused page, and that empty Enter does not submit the callback. The hosting machine SHALL require neither a browser nor an inbound callback port. After either login, application SHALL recheck persisted selected-provider authorization before reporting success, even when the login process exits zero. Reauthorization and token refresh SHALL preserve the same state directory.

#### Scenario: First account login
- **WHEN** no matching selected-provider authorization exists and the user chooses to log in
- **THEN** application runs that provider's no-browser flow and reports success only after matching authorization is found in the saved state
- **AND** the server opens no host callback port and other providers' authorization remains intact

#### Scenario: Recreate CLIProxyAPI
- **WHEN** its container is recreated
- **THEN** it reuses persisted OAuth authorization on the host service's state directory without client-side token files or deleting other provider accounts

#### Scenario: Claude manual callback
- **WHEN** the user completes Claude browser sign-in and reaches the final localhost callback URL
- **THEN** guidance directs them to paste that full URL into the terminal prompt that appears after 15 seconds, even if the browser cannot connect
- **AND** guidance does not instruct them to submit a blank line

#### Scenario: Login exits without matching credentials
- **WHEN** the provider login process exits zero but the selected-provider authorization check still finds no matching credential
- **THEN** application reports unsuccessful authorization instead of login success

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

### Requirement: Authenticated agent requests and URLs

The client model request SHALL authenticate as the selected memory user; the CLIProxyAPI credential SHALL remain server-side. The selected model SHALL be passed in the client's model request. Client-facing URLs SHALL use the supplied HTTP or HTTPS service origins, including direct local HTTP access and SHALL use certificate verification for HTTPS. Authentication diagnostics SHALL distinguish the memory user, model account and internal service connection.

#### Scenario: Model account is unavailable
- **WHEN** the memory user authenticates but the server model account is expired or unavailable
- **THEN** the diagnostic identifies the model authorization/connection stage without reporting successful model access

#### Scenario: TLS cannot be verified
- **WHEN** an external endpoint presents an invalid certificate
- **THEN** the connection fails without silently disabling verification

### Requirement: Clear listener audience labels

Application output SHALL label the implemented user-facing listeners as MemoryProxy (agent API) and Panel (web interface), using their actual saved addresses or ports. These labels SHALL NOT introduce new protocol routes or alter the approved separate connection-information message.

#### Scenario: Read applied listener addresses
- **WHEN** application prints the configured user-facing listeners
- **THEN** their labels identify MemoryProxy as the agent API and Panel as the web interface

### Requirement: Native APIs and separate AMS access boundary

MemoryProxy, Core, Knowledge and Panel SHALL use their selected upstream authentication behavior and native configuration. AMS SHALL not patch their user/session/asset checks or add a TDAI route allowlist. The separate AMS MCP/access endpoint SHALL retain its own caller and resource authorization. Native administrative protection SHALL use configured `admin.apiKey`; AMS SHALL not substitute a Panel user key. Host listeners SHALL default to loopback, and external proxy/firewall configuration SHALL remain operator-owned. Documentation SHALL distinguish native behavior from the AMS boundary's guarantees.

#### Scenario: Native agent request
- **WHEN** an agent contacts a native MemoryProxy route
- **THEN** its original path, query, method and body reach the stock handler
- **AND** the handler's stock authentication result is preserved, including upstream defects

#### Scenario: Unauthorized AMS tool request
- **WHEN** a caller uses the external AMS MCP/access endpoint without valid user/resource authorization
- **THEN** the AMS boundary denies forwarding without modifying TDAI

### Requirement: Observable stock streaming and readiness

AMS SHALL report process readiness separately from account authorization, external proxy availability and functional memory/model checks. Streaming, cancellation and retry behavior inside TDAI SHALL remain upstream-owned. AMS SHALL NOT patch handlers to enforce a different result or present old patched-stream tests as current acceptance.

#### Scenario: Observe a stock stream
- **WHEN** a stock TDAI streaming request is exercised and cancelled
- **THEN** validation records the observed behavior for that revision
- **AND** a cancellation or replay defect is reported without a local application correction

### Requirement: Native conversation and asset behavior

AMS client guidance SHALL pass the selected user, team, agent and conversation identifiers through native interfaces. Native TDAI SHALL determine session ownership, optional task handling and conversation persistence. AMS SHALL not alter native session stores, asset listings or ownership decisions; resource authorization at the separate AMS MCP/access boundary SHALL remain enforced.

#### Scenario: Native conversation request
- **WHEN** an agent submits or resumes a conversation using the documented native identifiers
- **THEN** AMS preserves those inputs and reports the actual upstream result without injecting an ownership or persistence fix

### Requirement: Native tool instructions and AMS secret handling

Native prompt construction, tool URLs, credential inclusion and injection behavior SHALL remain owned by TDAI. AMS SHALL supply supported native configuration and SHALL NOT rewrite generated instructions or patch Codex input handling. AMS-owned output, configuration review and MCP transport SHALL retain credential redaction and user isolation. Documentation SHALL not promise that stock model-visible instructions implement prior AMS patches.

#### Scenario: Native Codex instructions
- **WHEN** a client supplies a Responses instructions string
- **THEN** the stock Proxy determines how memory/tool content is included
- **AND** AMS does not modify the handler or rewrite its outgoing model request

### Requirement: Native standalone forwarding configuration

AMS SHALL express initial standalone preferences, including pricing, credit-reporting and rate-limit settings, using native configuration only. The selected TDAI revision SHALL determine the effect of those settings. AMS SHALL NOT alter forwarding or reporting code when a native setting is ignored or behaves unexpectedly.

#### Scenario: Native forwarding configuration
- **WHEN** the configured upstream receives a model request with standalone native options
- **THEN** its observed result is reported without an AMS code patch or fabricated guarantee that sample reporting is disabled
