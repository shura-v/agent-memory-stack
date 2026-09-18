## MODIFIED Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing the executable `ams`. Running `ams` SHALL offer exactly Configure stack, Apply configuration, and Show connection details, with Configure stack selected initially. Setup and its existing-stack guard SHALL begin only after the operator selects Configure stack. Apply configuration SHALL invoke the same saved-target workflow as standalone ams apply without a server argument. Show connection details SHALL show connection information only. The Configure stack guard SHALL NOT block either other menu action. Saved settings SHALL remain applicable through `ams apply` and the immediate-apply prompt. The package SHALL contain the compiled CLI and the templates/runtime assets needed by setup and application; execution SHALL not depend on the source checkout or developer sibling repositories. Release artifacts SHALL exclude real credentials and runtime data.

#### Scenario: Install the packed package
- **WHEN** the operator installs the locally produced npm archive into an isolated directory
- **THEN** the installed `ams` offers Configure stack, Apply configuration, and Show connection details and waits for selection
- **AND** the required templates resolve relative to the installed package while user output is written to the selected installation directory

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs ams apply
- **THEN** both paths use the same remembered target and application workflow without a server argument, configuration questions, or the Configure stack detection guard

## ADDED Requirements

### Requirement: Concise read-only agent connection information

Show connection details SHALL explain MemoryProxy as the agent's API with memory and MCP as Knowledge tools. The screen SHALL group output by service with its configured address, port, and matching credentials adjacent as defined in this change's design. This layout SHALL preserve the meanings of native Panel endpoint guidance, independent MemoryProxy/MCP connections, and localhost/Caddy access. The output SHALL direct users to Panel → API Keys → Client Access Endpoint for their existing agent-specific Base URL and API key. The explicit screen SHALL display every configured secret/key field defined by the existing `.env` schema, including saved credentials for inactive services, and all active, unexpired local Core user keys, including administrator keys. It SHALL label configured fields by setting name and purpose, identify Core user/key metadata and administrator privileges, and SHALL NOT ask the operator to select a single key. Full keys SHALL appear only after explicit screen selection, on plain copyable unwrapped lines beneath their labels within the matching service block. Panel SHALL show administrator login keys beside its URL; MemoryProxy and MCP SHALL each show all available active user keys beside their connection information. Core service, CLIProxyAPI, and Internal LLM blocks SHALL pair their endpoints or internal-only status with their respective saved credentials; Internal LLM SHALL also show configured models. Saved remote Core/model credentials SHALL appear beside their corresponding remote addresses, with retained inactive connections identified explicitly. It SHALL describe MCP's Streamable HTTP transport, `/mcp` path, Wiki/code tools, and memory-user authentication. It SHALL explain localhost access on the service host and Caddy domains preserving paths for another computer.

The action SHALL read saved installation settings without altering files, configuring agents, generating profiles or credentials, probing external endpoints, or starting/stopping containers. Captured read-only exec on the verified local Core container SHALL enumerate only active, unexpired key metadata once and recheck each key before reading its value once per screen. Repeated display in applicable service blocks SHALL reuse those captured values without another lookup. An individual key-read failure SHALL be reported without preventing display of the other keys. This lookup SHALL NOT write data or send secrets through process arguments or routine service logs. Service/provider credentials SHALL appear only on the explicitly opened screen and SHALL be distinguished from agent credentials. Saved settings SHALL be identified as configuration rather than verified running state. Missing or invalid saved configuration SHALL produce actionable Configure stack guidance. Disabled, remote-only, or unimplemented services SHALL NOT be described as listening on a local host port. MCP SHALL remain explicitly unavailable unless selected locally. Unavailable or remote Core SHALL retain configured `.env` credentials and connection guidance, and direct the operator to Panel for user keys. Successful Apply and TDAI update SHALL end with a recommendation to run ams and choose Show connection details without automatically revealing keys.

#### Scenario: Print configured local connections
- **WHEN** MemoryProxy and MCP are configured locally with saved host ports
- **THEN** each service block shows its configured address/port and matching credentials together, including the MCP `/mcp` URL and Streamable HTTP transport, while retaining Panel guidance and localhost/Caddy instructions
- **AND** no agent-specific endpoint paths, JSON profiles, or client installation commands are generated

#### Scenario: MCP is not yet configured
- **WHEN** the installation has no configured MCP service
- **THEN** output explicitly reports MCP as not configured and does not present a usable MCP port
- **AND** it retains the explanation of MCP's purpose as distinct from MemoryProxy

#### Scenario: Installation or local listener is absent
- **WHEN** saved configuration is missing, invalid, or describes a disabled or remote-only service
- **THEN** output provides configuration or service-host guidance without inventing local endpoints
- **AND** no setup workflow or deployment is started

#### Scenario: Display all configured and active user keys
- **WHEN** the operator opens Show connection details with local Core running
- **THEN** the screen displays every configured `.env` secret/key and all active, unexpired Core user keys, including administrator keys, without a key-selection prompt
- **AND** each value has its setting or user/key label and a plain copyable unwrapped line inside its matching service block
- **AND** Core keys are read once per screen and repeated in the applicable Panel, MemoryProxy, and MCP blocks
- **AND** inactive or expired Core keys are unavailable, credentials are not generated or persisted, and application logs contain no revealed key

#### Scenario: Show retained and private service connections
- **WHEN** a service interface is internal-only or a saved remote connection is currently inactive
- **THEN** its block identifies that state and displays its retained credential beside the corresponding saved address or internal-only status
- **AND** no local listener or agent-specific route is invented

#### Scenario: A Core key becomes unavailable during display
- **WHEN** an individual Core key is revoked, expires, or cannot be read after enumeration
- **THEN** the screen reports that item as unavailable and continues displaying the remaining keys and configured `.env` credentials

#### Scenario: Core is unavailable or remote
- **WHEN** the operator opens Show connection details without an accessible local Core
- **THEN** the screen still displays configured `.env` credentials and connection guidance
- **AND** it directs the operator to Panel for Core user keys

#### Scenario: Finish a long operation
- **WHEN** Apply or TDAI update completes successfully, including any account login
- **THEN** the final guidance recommends opening Show connection details through ams
- **AND** connection-detail credentials are not printed automatically
