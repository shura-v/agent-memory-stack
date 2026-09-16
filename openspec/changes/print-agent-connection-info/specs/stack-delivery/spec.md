## MODIFIED Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing the executable `ams`. Running `ams` SHALL offer exactly Configure stack, Apply configuration, and Connect an agent, with Configure stack selected initially. Setup and its existing-stack guard SHALL begin only after the operator selects Configure stack. Apply configuration SHALL invoke the same saved-target workflow as standalone ams apply without a server argument. Connect an agent SHALL show connection information only. The Configure stack guard SHALL NOT block either other menu action. Saved settings SHALL remain applicable through `ams apply` and the immediate-apply prompt. The package SHALL contain the compiled CLI and the templates/runtime assets needed by setup and application; execution SHALL not depend on the source checkout or developer sibling repositories. Release artifacts SHALL exclude real credentials and runtime data.

#### Scenario: Install the packed package
- **WHEN** the operator installs the locally produced npm archive into an isolated directory
- **THEN** the installed `ams` offers Configure stack, Apply configuration, and Connect an agent and waits for selection
- **AND** the required templates resolve relative to the installed package while user output is written to the selected installation directory

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs ams apply
- **THEN** both paths use the same remembered target and application workflow without a server argument, configuration questions, or the Configure stack detection guard

## ADDED Requirements

### Requirement: Concise read-only agent connection information

Connect an agent SHALL explain MemoryProxy as the agent's API with memory and MCP as Knowledge tools. The reference wording in this change's design SHALL be preserved verbatim, with configured port substitution and explicit service availability adjustments. The output SHALL direct users to Panel → API Keys → Client Access Endpoint for their existing agent-specific Base URL and API key. It SHALL describe MCP's Streamable HTTP transport, `/mcp` path, Wiki/code tools, and memory-user authentication. It SHALL explain localhost access on the service host and Caddy domains preserving paths for another computer.

The action SHALL read saved installation settings without altering files, configuring agents, generating profiles or credentials, probing networks, or operating containers. Service/provider credentials SHALL remain absent from output. Saved settings SHALL be identified as configuration rather than verified running state. Missing or invalid saved configuration SHALL produce actionable Configure stack guidance. Disabled, remote-only, or unimplemented services SHALL NOT be described as listening on a local host port. MCP SHALL remain explicitly unavailable until configured through the separate MCP deployment capability.

#### Scenario: Print configured local connections
- **WHEN** MemoryProxy and MCP are configured locally with saved host ports
- **THEN** output uses the agreed wording with those ports, `/mcp`, Panel guidance, and localhost/Caddy instructions
- **AND** no agent-specific endpoint paths, JSON profiles, or client installation commands are generated

#### Scenario: MCP is not yet configured
- **WHEN** the installation has no configured MCP service
- **THEN** output explicitly reports MCP as not configured and does not present a usable MCP port
- **AND** it retains the explanation of MCP's purpose as distinct from MemoryProxy

#### Scenario: Installation or local listener is absent
- **WHEN** saved configuration is missing, invalid, or describes a disabled or remote-only service
- **THEN** output provides configuration or service-host guidance without inventing local endpoints
- **AND** no setup workflow or deployment is started
