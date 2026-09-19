## MODIFIED Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing the executable `ams`. Running `ams` SHALL offer exactly Configure stack, Apply configuration, and Show connection details, with Configure stack selected initially. Setup and its existing-stack guard SHALL begin only after the operator selects Configure stack. Apply configuration SHALL invoke the same fixed-runtime-directory workflow as standalone ams apply without a server argument. Show connection details SHALL show connection information only. The Configure stack guard SHALL NOT block either other menu action. Saved settings SHALL remain applicable through `ams apply` and the immediate-apply prompt. The package SHALL contain the compiled CLI, complete native templates from the verified TDAI revision with source paths and hashes, and the runtime assets needed by setup and application; execution SHALL not depend on the source checkout or developer sibling repositories. Release artifacts SHALL exclude real credentials and runtime data.

#### Scenario: Install the packed package
- **WHEN** the operator installs the locally produced npm archive into an isolated directory
- **THEN** the installed `ams` offers Configure stack, Apply configuration, and Show connection details and waits for selection
- **AND** the required templates resolve relative to the installed package while visible defaults/ and overrides/ are written to the recorded native configuration root and runtime artifacts remain in the fixed runtime installation directory

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs ams apply
- **THEN** both paths use the same fixed runtime directory, associated native root, and application workflow without a server argument or the Configure stack detection guard, reusing saved settings without model discovery, model prompts or required-model enforcement

### Requirement: Explicit interactive configuration and cancellation

Setup SHALL accept text inputs without configured-value validators and retain its normal select-menu choices. It SHALL request the interactive settings consumed by the complete local stack, offer defaults for operational choices, and ask for real provider credentials and endpoints when an external internal-model source is selected. Local CLIProxyAPI mode SHALL derive its initial API access and ask for Core and Knowledge models during Configure stack without requiring provider authorization. Apply SHALL consume saved files without requesting or validating model values. Missing locally owned Core and CLIProxyAPI service keys SHALL be generated automatically; existing keys SHALL be reused without keep, generation, or manual-entry questions. These keys SHALL be saved only at the existing configuration-save boundary and SHALL remain stable across question navigation. Persisted keys SHALL remain authoritative in their owning configuration files. Advanced native token limits and LLM timeouts SHALL remain editable in the corresponding partial native overrides, inheriting upstream defaults when absent, without additional wizard questions. Setup SHALL populate known installation values once in overrides while keeping defaults as exact complete upstream templates. Ordinary apply and update SHALL preserve override bytes; explicit wizard edits SHALL change only reviewed fields and preserve unrelated values. Configured values SHALL remain operator-owned; AMS SHALL check document integrity and report actual runtime failures without enforcing value policies. Secret input SHALL be masked; configuration review and routine diagnostics SHALL redact secret values. The intentional initial admin-key handoff is the documented exception. Cancellation before saving SHALL not deploy services or replace an existing configuration. Cancellation after saving SHALL retain the saved desired settings without replaying installation effects.

Setup SHALL explain automatically derived local service addresses and apply-time port allocation without asking for stack URLs, ports, service selection, remote placement, or interface enablement. Native external origins and service networking SHALL remain editable through overrides; AMS publication and other orchestration choices SHALL remain editable through .env. Saving alone SHALL require neither a running engine nor port allocation. Saved non-secret values SHALL take precedence over fresh defaults; remaining interactive values SHALL be offered for reuse.

#### Scenario: Cancel the wizard
- **WHEN** the user cancels before saving setup
- **THEN** existing configuration and running services remain unchanged
- **AND** transient secrets are not written to files

#### Scenario: Defer application after saving
- **WHEN** the user declines immediate application or cancels after configuration is saved
- **THEN** the saved desired settings remain available for `ams apply`
- **AND** no installation work is started or replayed by cancellation

#### Scenario: Repeat with existing credentials
- **WHEN** setup reads existing Core and CLIProxyAPI service keys
- **THEN** setup reuses their exact values without confirmation or exposing them in prompts or review output
- **AND** administrator, provider, and service credentials retain their separate contracts

#### Scenario: Generate missing internal keys
- **WHEN** a configured local Core or CLIProxyAPI has no saved service key
- **THEN** setup generates its independent key without asking a question and preserves it across back navigation
- **AND** cancellation before saving does not persist it, while saving records it in its owning persistent configuration for reuse

### Requirement: One editable server environment file

One installation `.env` SHALL remain the editable source for AMS orchestration choices. Native TDAI service settings SHALL be composed from two visible sets under the native configuration root: exact revision-matched originals in defaults/ and partial user-editable YAML, JSON, or env documents in overrides/, with explicit deletion declarations when required. CLIProxyAPI and AMS helper configuration SHALL retain their existing lifecycle; this native-template ownership change SHALL apply to Core, MemoryProxy, Knowledge, and Panel. Applying changed settings SHALL preserve overrides and the complete native surface, compose and structurally check effective documents, and recreate affected containers as needed. AMS SHALL NOT regenerate a restricted service-field subset or supply independent competing Compose/environment values for native settings; required environment transport SHALL be derived only from the effective documents. A plain container restart SHALL NOT be described as reloading Compose environment values. The initial Core administrator credential SHALL not be persisted in these files. The separate native MemoryProxy administrative credential SHALL follow its persistent service-secret contract.

#### Scenario: Apply a new model or endpoint
- **WHEN** the user changes the model or endpoint in its owning native override file and performs the documented apply operation
- **THEN** consumers use the updated native settings without AMS overwriting them during apply
- **AND** the operation does not recreate the administrator or rotate existing service secrets

#### Scenario: Preserve literal provider keys
- **WHEN** a provider key contains supported quote, backslash or dollar characters
- **THEN** the consuming service receives its exact value without shell execution or recursive interpolation

### Requirement: Independent generated keys and secret handling

Generated stack keys SHALL use `sk-ams-<purpose>-<64 lowercase hexadecimal characters>` with an independently generated 32-byte random suffix per role. Roles SHALL include the initial Core administrator, Core service access, CLIProxyAPI access, and native MemoryProxy administration. The generated MemoryProxy administrative credential SHALL use an independent 32-byte random suffix and persist in its native override. Operator-supplied or subsequently edited credentials SHALL NOT undergo distinctness or nonempty-value enforcement. Provider-issued and operator-supplied keys SHALL retain their supplied value. Persistent service credentials and OAuth files SHALL use restricted permissions and be excluded from Git, npm archives and image build contexts. The setup program SHALL not persist a separate copy of the initial Core administrator key; that identity remains in Core's database after initialization. This transient user-identity rule SHALL remain distinct from the persistent native MemoryProxy administration secret.

#### Scenario: Prepare service credentials
- **WHEN** the user accepts generated internal API keys
- **THEN** their values are independent and stored in the server configuration for reuse
- **AND** repeated setup does not replace them without an explicit credential change

#### Scenario: Inspect distributable contents
- **WHEN** the npm archive or container build context is inspected
- **THEN** real `.env`, authorization files, secret-bearing overrides, composed runtime files or snapshots, and application data are absent

### Requirement: Persistent lifecycle and consistent recovery

The delivery SHALL identify all authoritative application data, including Core metadata/credential database, memory, Knowledge, persistent Panel/Proxy state and server OAuth. Restart and container recreation SHALL retain this state. Backup/restore SHALL include a consistent application data set, matching exact defaults, byte-preserved overrides and deletion declarations, template manifest, initial-origin state, selected source and image records, persistent secrets, and the reference between configuration and runtime roots. Native configuration changes or TDAI updates SHALL preserve the existing runtime working directory, Compose project identity, and application data paths. Native configuration location SHALL NOT determine a new application identity. User-owned Caddy and TLS state SHALL remain outside this package's backup responsibility. OAuth recovery checks SHALL use one active refresher for the restored account.

#### Scenario: Restart without bootstrap secret
- **WHEN** initialized services are restarted or recreated from existing state
- **THEN** data and administrator identity remain usable without the initial setup key being supplied again

#### Scenario: Restore a backup
- **WHEN** a consistent backup is restored into isolated storage with compatible images and service settings
- **THEN** saved conversations, Knowledge assets and the existing administrator identity remain available
- **AND** the source installation's data is unchanged

#### Scenario: Restore a versioned native configuration
- **WHEN** an installation backup containing user-edited native overrides is restored
- **THEN** both sets, deletion declarations, template manifest, root association, initial-origin state, source/image records, and persistent secrets are restored together
- **AND** subsequent apply preserves the restored overrides without rotating credentials or creating another application identity

### Requirement: Concise read-only agent connection information

Show connection details SHALL explain MemoryProxy as the agent's API with memory and MCP as Knowledge tools. The screen SHALL group output by service with its configured address, port, and matching credentials adjacent. This layout SHALL preserve the meanings of native Panel endpoint guidance, independent MemoryProxy/MCP connections, and localhost/Caddy access. The output SHALL direct users to Panel → API Keys → Client Access Endpoint for their existing agent-specific Base URL and API key. The explicit screen SHALL display every configured credential covered by the connection-information contract from its effective composed native document or authoritative AMS orchestration setting, and all active, unexpired local Core user keys, including administrator keys. It SHALL label configured fields by their owning default/override file, setting name and purpose, identify Core user/key metadata and administrator privileges, and SHALL NOT ask the operator to select a single key. Full keys SHALL appear only after explicit screen selection, on plain copyable unwrapped lines beneath their labels within the matching service block. Panel SHALL show administrator login keys beside its URL; MemoryProxy and MCP SHALL each show all available active user keys beside their connection information. Core service, CLIProxyAPI, and Internal LLM blocks SHALL pair their endpoints or internal-only status with their respective saved credentials; Internal LLM SHALL show each native consumer's effective base, credential and configured model independently, preserving different Core and Knowledge overrides. MemoryProxy SHALL separately label its native `admin.apiKey` administrative credential; that credential SHALL NOT be described as a Panel login or ordinary agent key. It SHALL describe MCP's Streamable HTTP transport, `/mcp` path, Wiki/code tools, and memory-user authentication. It SHALL explain localhost access on the service host and Caddy domains preserving paths for another computer.

The action SHALL compose and read saved installation settings without altering files, configuring agents, generating profiles or credentials, probing external endpoints, or starting/stopping containers. Captured read-only exec on the verified local Core container SHALL enumerate only active, unexpired key metadata once and recheck each key before reading its value once per screen. Repeated display in applicable service blocks SHALL reuse those captured values without another lookup. An individual key-read failure SHALL be reported without preventing display of the other keys. This lookup SHALL NOT write data or send secrets through process arguments or routine service logs. Service/provider credentials SHALL appear only on the explicitly opened screen and SHALL be distinguished from agent credentials. Saved settings SHALL be identified as configuration rather than verified running state. Missing configuration or structural/provenance failures SHALL produce actionable guidance. Unpublished service interfaces SHALL be labeled internal-only. MCP SHALL always have its configured local interface. Unavailable Core SHALL retain configured native and orchestration credentials and connection guidance, and direct the operator to Panel for user keys. Successful Apply and TDAI update SHALL end with a recommendation to run ams and choose Show connection details without automatically revealing keys.

#### Scenario: Print configured local connections
- **WHEN** MemoryProxy and MCP are configured locally with saved host ports
- **THEN** each service block shows its configured address/port and matching credentials together, including the MCP `/mcp` URL and Streamable HTTP transport, while retaining Panel guidance and localhost/Caddy instructions
- **AND** no agent-specific endpoint paths, JSON profiles, or client installation commands are generated

#### Scenario: Installation or local listener is absent
- **WHEN** saved configuration is missing or structurally invalid
- **THEN** output provides configuration or service-host guidance without inventing local endpoints
- **AND** no setup workflow or deployment is started

#### Scenario: Display all configured and active user keys
- **WHEN** the operator opens Show connection details with local Core running
- **THEN** the screen displays every configured native and orchestration credential covered by the connection-information contract and all active, unexpired Core user keys, including administrator keys, without a key-selection prompt
- **AND** each value has its setting or user/key label and a plain copyable unwrapped line inside its matching service block
- **AND** Core keys are read once per screen and repeated in the applicable Panel, MemoryProxy, and MCP blocks
- **AND** inactive or expired Core keys are unavailable, credentials are not generated or persisted, and application logs contain no revealed key

#### Scenario: Show retained and private service connections
- **WHEN** a service interface is internal-only
- **THEN** its block identifies that state and displays its retained credential beside the corresponding saved address or internal-only status
- **AND** no local listener or agent-specific route is invented

#### Scenario: A Core key becomes unavailable during display
- **WHEN** an individual Core key is revoked, expires, or cannot be read after enumeration
- **THEN** the screen reports that item as unavailable and continues displaying the remaining keys and configured native and orchestration credentials

#### Scenario: Core is unavailable
- **WHEN** the operator opens Show connection details without an accessible local Core
- **THEN** the screen still displays configured native and orchestration credentials and connection guidance
- **AND** it directs the operator to Panel for Core user keys

#### Scenario: Finish a long operation
- **WHEN** Apply or TDAI update completes successfully, including any account login
- **THEN** the final guidance recommends opening Show connection details through ams
- **AND** connection-detail credentials are not printed automatically

#### Scenario: Display native consumer overrides
- **WHEN** Core and Knowledge have independently edited native model connections
- **THEN** the screen shows each effective native connection and credential under its owning service, identifying their native source fields
- **AND** the persistent native MemoryProxy administrator credential has its own administrative-purpose label and appears only on this explicitly selected screen
