> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing `ams`. The menu SHALL offer exactly Configure stack, Apply configuration and Show connection details, each explicitly selected, with Configure initially selected. Menu Apply, standalone `ams apply` and immediate application SHALL use one fixed-runtime-directory workflow without configuration questions. The package SHALL include AMS-owned compiled code, build recipes and source metadata, and SHALL exclude TDAI template copies, source patches, installation credentials and runtime data. Native templates SHALL be acquired from the selected source independently of the caller's checkout.

#### Scenario: Install the packed package
- **WHEN** the operator configures an isolated installation from the installed npm archive
- **THEN** AMS obtains selected-source templates into flat defaults and saves operator overrides
- **AND** no developer checkout, packaged native template tree, running engine or image build is required to save configuration

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs `ams apply`
- **THEN** both apply the saved files without invoking Configure or requesting model choices

## ADDED Requirements

### Requirement: Concise read-only agent connection information

The screen SHALL end with a visibly separated Agent connections section containing the MemoryProxy and MCP connection blocks with their available user keys, followed by a link to https://github.com/shura-v/agent-memory-stack/blob/main/docs/agent-profiles/README.md. Internal services, native administrative credentials and general access guidance SHALL appear before that section. The final section SHALL reuse the keys already read for the screen and retain native Panel endpoint guidance.

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
