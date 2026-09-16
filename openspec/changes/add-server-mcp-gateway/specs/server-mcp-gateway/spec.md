## Purpose

Provide server-hosted Knowledge MCP access for local or remote agents while retaining the caller's memory-user identity and existing resource permissions.

## ADDED Requirements

### Requirement: Server-hosted Streamable HTTP

MCP SHALL join fresh full-stack defaults once implemented and preserve existing explicit service selections. When configured, MCP SHALL run in the installation's Compose deployment and serve Streamable HTTP at `/mcp`. Its published host port SHALL bind only to `127.0.0.1` and use shared automatic allocation during apply, preferring saved/default ports and persisting the resolved value. Setup SHALL ask no MCP port or enablement question; advanced selection and remote dependencies SHALL be configured through .env. Clients SHALL require no local Knowledge stdio process. Remote access SHALL remain under the operator's reverse proxy configuration.

#### Scenario: Connect on the same machine
- **WHEN** an agent runs on the machine hosting the enabled MCP service
- **THEN** it can address `http://localhost:<configured-port>/mcp`
- **AND** MCP execution and Knowledge forwarding remain in the server deployment

#### Scenario: Operator publishes a remote endpoint
- **WHEN** an operator proxies the MCP loopback port through Caddy
- **THEN** the agent uses the operator's HTTPS origin with `/mcp` preserved
- **AND** AMS creates no public listener, DNS record, TLS certificate, or reverse proxy configuration

### Requirement: Memory-user authentication and isolation

Every MCP request SHALL require the caller's memory-user API key as a Bearer credential. MCP sessions, streams, subprocess state, and results SHALL remain isolated to their authenticated caller. A session identifier SHALL NOT substitute for authentication. User keys SHALL NOT be replaced with an administrator or service key, persisted in generated deployment files, or printed in logs. Revoked or inactive users SHALL lose access.

#### Scenario: Different users share one endpoint
- **WHEN** two memory users connect to the same MCP endpoint
- **THEN** each request and response remains bound to its authenticated user
- **AND** presenting another user's session identifier is rejected

#### Scenario: Credential is missing or revoked
- **WHEN** a caller omits a key or presents an invalid, revoked, or inactive user's key
- **THEN** MCP rejects the request without invoking Knowledge tools

### Requirement: Protected Knowledge tool contract

MCP SHALL forward Knowledge operations through the protected tools interface using the caller's key and the configured service instance. A local protected gateway SHALL remain internal to Compose by default; local MCP SHALL NOT require Knowledge host-port publication. Explicit remote configurations SHALL distinguish the protected tools endpoint from raw service routes. Listing and calling resource tools SHALL require an explicit Knowledge resource identifier and enforce existing asset, team, and user permissions. The MCP interface SHALL expose the resource identifier and tool arguments required for these operations. It SHALL NOT expose raw administrative Wiki or CodeGraph routes as an authorization bypass.

#### Scenario: Invoke an allowed resource tool
- **WHEN** an authenticated user requests a tool for a Knowledge resource they can use
- **THEN** the protected interface checks that user's access and executes the tool with the existing resource context

#### Scenario: Resource is outside the user's access
- **WHEN** a user lists or calls tools for a resource outside their active team or permissions
- **THEN** the existing Knowledge authorization boundary denies the request
- **AND** MCP does not retry it using elevated credentials

### Requirement: Connection metadata and acceptance boundary

Saved installation configuration SHALL identify whether MCP is selected and its resolved saved host port for the separate connection-information workflow. Configuration SHALL distinguish desired state from evidence that containers started. Acceptance at this stage SHALL be limited to building required images and starting selected containers; comprehensive functional verification SHALL follow the remaining integration work.

#### Scenario: Read connection information
- **WHEN** the connection-information workflow reads a saved installation with MCP selected
- **THEN** it can obtain the MCP enabled state and configured port without prompting for agent configuration or retrieving a user's secret
- **AND** a successful build and start is not presented as full MCP or agent validation
