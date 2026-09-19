# stack-delivery Specification

## Purpose

Deliver a modular npm package with stack setup, pinned container images, and a verifiable configuration and data lifecycle.

## Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing `ams`. The menu SHALL offer exactly Configure stack, Apply configuration and Show connection details, each explicitly selected, with Configure initially selected. Menu Apply, standalone `ams apply` and immediate application SHALL use one fixed-runtime-directory workflow without configuration questions. The package SHALL include AMS-owned compiled code, build recipes and source metadata, and SHALL exclude TDAI template copies, source patches, installation credentials and runtime data. Native templates SHALL be acquired from the selected source independently of the caller's checkout.

#### Scenario: Install the packed package
- **WHEN** the operator configures an isolated installation from the installed npm archive
- **THEN** AMS obtains selected-source templates into flat defaults and saves operator overrides
- **AND** no developer checkout, packaged native template tree, running engine or image build is required to save configuration

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs `ams apply`
- **THEN** both apply the saved files without invoking Configure or requesting model choices

### Requirement: Modular TypeScript and interaction boundary

Authored application code SHALL use TypeScript with strict type checking. CLI presentation, setup workflows, configuration, runtime integration and build delivery SHALL have distinct responsibilities. Clack interaction SHALL be replaceable in workflow tests without a terminal. The selected stable `@clack/prompts` version SHALL be verified when added and pinned with its dependency lock.

#### Scenario: Validate package implementation
- **WHEN** the package is built and checked
- **THEN** strict TypeScript validation passes, the compiled CLI is executable and the setup workflow can be exercised through a test interaction adapter

### Requirement: Explicit interactive configuration and cancellation

Setup SHALL accept text inputs without configured-value validators and retain its normal select-menu choices. It SHALL request the interactive settings consumed by the complete local stack, offer defaults for operational choices, and ask for real provider credentials and endpoints when an external internal-model source is selected. When the entered external model API base URL differs from its saved value, setup SHALL request a new API key directly instead of offering to keep the key associated with the previous endpoint. An unchanged base URL SHALL retain the existing-key confirmation. Local CLIProxyAPI mode SHALL derive its initial API access and ask for Core and Knowledge models during Configure stack without requiring provider authorization. Apply SHALL consume saved files without requesting or validating model values. Missing CLIProxyAPI service keys SHALL be generated automatically; existing keys SHALL be reused without keep, generation, or manual-entry questions. AMS SHALL NOT generate or initially seed Core server.apiKey. An operator-configured Core service key SHALL remain authoritative in native configuration. These keys SHALL be saved only at the existing configuration-save boundary and SHALL remain stable across question navigation. Persisted keys SHALL remain authoritative in their owning configuration files. Advanced native token limits and LLM timeouts SHALL remain editable in the corresponding partial native overrides, inheriting upstream defaults when absent, without additional wizard questions. Setup SHALL populate known installation values once in overrides while keeping defaults as exact complete upstream templates. Ordinary apply and update SHALL preserve override bytes; explicit wizard edits SHALL change only reviewed fields and preserve unrelated values. Configured values SHALL remain operator-owned; AMS SHALL check document integrity and report actual runtime failures without enforcing value policies. Secret input SHALL be masked; configuration review and routine diagnostics SHALL redact secret values. The intentional initial admin-key handoff is the documented exception. Cancellation before saving SHALL not deploy services or replace an existing configuration. Cancellation after saving SHALL retain the saved desired settings without replaying installation effects.

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

#### Scenario: Change the external model endpoint
- **WHEN** Configure receives an external model API base URL different from the saved URL while a provider API key is already saved
- **THEN** it skips the keep-existing-key confirmation and asks for a new masked API key
- **AND** an unchanged URL continues to offer the existing-key confirmation

#### Scenario: Generate missing internal keys
- **WHEN** the local CLIProxyAPI has no saved service key
- **THEN** setup generates its independent key without asking a question and preserves it across back navigation
- **AND** cancellation before saving does not persist it, while saving records it in its owning persistent configuration for reuse

### Requirement: One editable server environment file

AMS orchestration settings SHALL reside in the runtime `.env`; native TDAI configuration SHALL reside in the recorded flat defaults/overrides sets. Composed container inputs SHALL be derived artifacts, not another editable source. Apply SHALL read both sets and recreate containers as needed. The initial Core administrator user key SHALL not be persisted as a separate configuration copy. MemoryProxy's independent administrative credential SHALL be initialized in `overrides/proxy.yaml` at `admin.apiKey`; subsequent operator changes SHALL remain unvalidated and SHALL not be automatically restored. No custom dotenv encoding or injected parser SHALL replace native service semantics.

#### Scenario: Apply a new model or endpoint
- **WHEN** the user changes the model in its native override and runs Apply
- **THEN** the consuming service receives the composed native document without requiring a duplicate model in runtime `.env`
- **AND** Apply does not rotate credentials or repopulate intentionally removed values

#### Scenario: Check configuration without execution
- **WHEN** standalone configuration check reads an installation
- **THEN** it checks parsing, composition and runtime-reference structure without writes or configured-value policy
- **AND** its success does not claim that upstream accepts the values or that services are operational

#### Scenario: Preserve literal provider keys
- **WHEN** a saved provider key contains characters interpreted by the native service parser
- **THEN** AMS preserves the operator's file value and delivers it without shell evaluation
- **AND** runtime expansion and quoting follow the stock parser rather than an AMS corrective codec

### Requirement: Independent generated keys and secret handling

Generated stack keys SHALL use `sk-ams-<purpose>-<64 lowercase hexadecimal characters>` with an independently generated 32-byte random suffix per role. Roles SHALL include the initial Core administrator, CLIProxyAPI access, and native MemoryProxy administration. AMS SHALL NOT generate a Core service credential. The generated MemoryProxy administrative credential SHALL use an independent 32-byte random suffix and persist in its native override. Operator-supplied or subsequently edited credentials SHALL NOT undergo distinctness or nonempty-value enforcement. Provider-issued and operator-supplied keys SHALL retain their supplied value. Persistent service credentials and OAuth files SHALL use restricted permissions and be excluded from Git, npm archives and image build contexts. The setup program SHALL not persist a separate copy of the initial Core administrator key; that identity remains in Core's database after initialization. This transient user-identity rule SHALL remain distinct from the persistent native MemoryProxy administration secret.

#### Scenario: Prepare service credentials
- **WHEN** the user accepts generated internal API keys
- **THEN** their values are independent and stored in the server configuration for reuse
- **AND** repeated setup does not replace them without an explicit credential change

#### Scenario: Inspect distributable contents
- **WHEN** the npm archive or container build context is inspected
- **THEN** real `.env`, authorization files, secret-bearing overrides, composed runtime files or snapshots, and application data are absent

### Requirement: Pinned images and separate build lifecycle

Build definitions SHALL record immutable source revisions, supported base-image identities and output image/platform identities. TDAI dependencies SHALL come from the selected upstream manifests and locks where supplied; AMS SHALL NOT substitute its own TDAI manifests or locks. Missing upstream locks SHALL be reported as a reproducibility limitation. AMS-owned runtime and MCP gateway dependencies SHALL use the root package.json and package-lock.json, with a generated lock copy supplied to installed-package container builds. Third-party source metadata SHALL reside under vendor/; AMS build recipes SHALL reside under deploy/. Apply SHALL reuse verified images and build missing images before starting services. Offline delivery SHALL include compatible images, source identity and the verified source archive needed to extract native defaults, without secrets or operator overrides. Licenses SHALL remain included.

#### Scenario: Build and deliver images
- **WHEN** images are built from the selected source
- **THEN** AMS verifies the archive, uses upstream dependency inputs and records output content/platform identities
- **AND** the installed package can reuse those images without a developer checkout

#### Scenario: Upstream changes a dependency
- **WHEN** a selected TDAI revision changes its package manifest or supplied lock
- **THEN** the build consumes that revision's files without overlaying previous AMS copies

#### Scenario: Offline installation
- **WHEN** an installation imports a complete compatible image/source bundle without network access
- **THEN** it can extract native defaults and use the verified images without downloading or compiling sources on that host
- **AND** native files retain the same flat defaults/overrides layout

#### Scenario: Source or platform mismatch
- **WHEN** archive integrity or image platform verification fails
- **THEN** delivery stops before service initialization and preserves the previous configuration

### Requirement: Persistent lifecycle and consistent recovery

The delivery SHALL identify all authoritative application data, including Core metadata/credential database, memory, Knowledge, persistent Panel/Proxy state and server OAuth. Restart and container recreation SHALL retain this state. Native configuration backup SHALL contain `root`, complete `defaults`, `overrides`, and optional `deletions`; additional fields SHALL be ignored. Initial-origin state SHALL remain in `.ams/native-config.json`, and selected source SHALL remain in `.ams/tdai-source.json`. Backup/restore SHALL keep those records with exact defaults, byte-preserved overrides and deletion declarations, selected image records, persistent secrets, and the reference between configuration and runtime roots. `.ams-state.json` SHALL be absent from the backup contract and ignored if present as an unrelated file. Native configuration changes or TDAI updates SHALL preserve the existing runtime working directory, Compose project identity, application data paths, OAuth state, and existing credentials. Native configuration location SHALL NOT determine a new application identity. User-owned Caddy and TLS state SHALL remain outside this package's backup responsibility. OAuth recovery checks SHALL use one active refresher for the restored account.

#### Scenario: Restart without bootstrap secret
- **WHEN** initialized services are restarted or recreated from existing state
- **THEN** data and administrator identity remain usable without the initial setup key being supplied again

#### Scenario: Restore a backup
- **WHEN** a consistent backup is restored into isolated storage with compatible images and service settings
- **THEN** saved conversations, Knowledge assets and the existing administrator identity remain available
- **AND** the source installation's data is unchanged

#### Scenario: Restore a versioned native configuration
- **WHEN** an installation backup containing user-edited native overrides is restored
- **THEN** both sets, deletion declarations, root association, initial-origin state, source/image records, and persistent secrets are restored together
- **AND** subsequent apply preserves the restored overrides without rotating credentials or creating another application identity

### Requirement: Build and container startup acceptance

The current delivery stage SHALL have one acceptance criterion: the required container images have been built and the complete Compose stack has been started. Long-running services SHALL remain running at the recorded observation point, and required one-shot initialization containers SHALL complete successfully. The record SHALL identify the tested image set, platform, and container runtime. Functional validation SHALL be recorded separately for the selected unmodified TDAI revision; build-and-start evidence alone SHALL NOT claim provider, MCP, memory, Wiki or recovery correctness.

#### Scenario: Accept the container delivery stage
- **WHEN** the required images build successfully and the complete stack starts
- **THEN** the build-and-start acceptance criterion is satisfied for that recorded environment
- **AND** agent requests, MCP, provider authorization, memory/Wiki behavior, and full recovery remain subjects of later comprehensive validation

#### Scenario: Image build or container startup fails
- **WHEN** a required image cannot be built, a required long-running container cannot stay running, or a required initialization job fails
- **THEN** build-and-start acceptance remains incomplete and records the failing stage

### Requirement: Runtime claims match tested environments

Documentation SHALL name the actual OS, CPU architecture, container engine and Compose provider used for validation. Commands SHALL use public runtime interfaces directly rather than depend on shell aliases. Prerequisite and permission failures SHALL identify the failing stage without claiming deployment success.

#### Scenario: Unsupported runtime prerequisite
- **WHEN** Compose support, required filesystem permissions or an image platform is unavailable
- **THEN** setup reports the prerequisite failure before initialization changes application data

### Requirement: Concise read-only agent connection information

The screen SHALL end with a visibly separated Agent connections section containing the MemoryProxy and MCP connection blocks with their available user keys, followed by a link to https://github.com/shura-v/agent-memory-stack/blob/main/docs/agent-profiles/README.md. Internal services, native administrative credentials and general access guidance SHALL appear before that section. The final section SHALL reuse the keys already read for the screen and retain native Panel endpoint guidance.

Show connection details SHALL explain MemoryProxy as the agent's API with memory and MCP as Knowledge tools. The screen SHALL group output by service with its configured address, port, and matching credentials adjacent. This layout SHALL preserve the meanings of native Panel endpoint guidance, independent MemoryProxy/MCP connections, and localhost/Caddy access. The output SHALL direct users to Panel → API Keys → Client Access Endpoint for their existing agent-specific Base URL and API key. The explicit screen SHALL display every configured credential covered by the connection-information contract from its effective composed native document or authoritative AMS orchestration setting, and all active, unexpired local Core user keys, including administrator keys. It SHALL label configured fields by their owning default/override file, setting name and purpose, identify Core user/key metadata and administrator privileges, and SHALL NOT ask the operator to select a single key. Full keys SHALL appear only after explicit screen selection, on plain copyable unwrapped lines beneath their labels within the matching service block. Panel SHALL show administrator login keys beside its URL; MemoryProxy and MCP SHALL each show all available active user keys beside their connection information. Core service, CLIProxyAPI, and Internal LLM blocks SHALL pair their endpoints or internal-only status with their respective saved credentials; Internal LLM SHALL show each native consumer's effective base, credential and configured model independently, preserving different Core and Knowledge overrides. MemoryProxy SHALL separately label its native `admin.apiKey` administrative credential; that credential SHALL NOT be described as a Panel login or ordinary agent key. It SHALL describe MCP's Streamable HTTP transport, `/mcp` path, Wiki/code tools, and memory-user authentication. It SHALL explain localhost access on the service host and Caddy domains preserving paths for another computer.

The action SHALL compose and read saved installation settings without altering files, configuring agents, generating profiles or credentials, probing external endpoints, or starting/stopping containers. Captured read-only exec on the verified local Core container SHALL enumerate only active, unexpired key metadata once and recheck each key before reading its value once per screen. Repeated display in applicable service blocks SHALL reuse those captured values without another lookup. An individual key-read failure SHALL be reported without preventing display of the other keys. This lookup SHALL NOT write data or send secrets through process arguments or routine service logs. Service/provider credentials SHALL appear only on the explicitly opened screen and SHALL be distinguished from agent credentials. Saved settings SHALL be identified as configuration rather than verified running state. Missing configuration or structural failures SHALL produce actionable guidance. Unpublished service interfaces SHALL be labeled internal-only. MCP SHALL always have its configured local interface. Unavailable Core SHALL retain configured native and orchestration credentials and connection guidance, and direct the operator to Panel for user keys. Successful Apply and TDAI update SHALL end with a recommendation to run ams and choose Show connection details without automatically revealing keys.

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
