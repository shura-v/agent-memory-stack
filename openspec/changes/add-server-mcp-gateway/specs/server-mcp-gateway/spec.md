> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## Purpose

Provide server-hosted Knowledge MCP access for local or remote agents while retaining the caller's memory-user identity and existing resource permissions.

## ADDED Requirements

### Requirement: Server-hosted Streamable HTTP

MCP SHALL run in every full-stack installation and SHALL execute the selected unchanged TDAI stdio MCP artifact behind the official SDK HTTP/stdio transport. It SHALL run in the installation's Compose deployment and serve stateless Streamable HTTP at `/mcp`. Its published host port SHALL bind only to `127.0.0.1` and use shared automatic allocation during apply, preferring saved/default ports and persisting the resolved value. Setup SHALL ask no MCP port or enablement question; publication settings SHALL remain in runtime .env. Clients SHALL require no local Knowledge stdio process. Remote access SHALL remain under the operator's reverse proxy configuration.

#### Scenario: Connect on the same machine
- **WHEN** an agent runs on the machine hosting the MCP service
- **THEN** it can address `http://localhost:<configured-port>/mcp`
- **AND** MCP execution and Knowledge forwarding remain in the server deployment

#### Scenario: Operator publishes a remote endpoint
- **WHEN** an operator proxies the MCP loopback port through Caddy
- **THEN** the agent uses the operator's HTTPS origin with `/mcp` preserved
- **AND** AMS creates no public listener, DNS record, TLS certificate, or reverse proxy configuration

### Requirement: Memory-user authentication and isolation

Every MCP request SHALL require the caller's memory-user API key as a Bearer credential. Each HTTP POST SHALL own isolated transport and stock stdio subprocess state for its authenticated caller. Requests SHALL NOT reuse another request's process or credential state. No persistent MCP session or credential pool SHALL be retained. User keys SHALL NOT be replaced with an administrator or service key, persisted in generated deployment files, or printed in logs. Revoked or inactive users SHALL lose access.

#### Scenario: Different users share one endpoint
- **WHEN** two memory users connect to the same MCP endpoint
- **THEN** each request and response remains bound to its authenticated user
- **AND** each POST uses a separate stock child with its own caller credential

#### Scenario: Credential is missing or revoked
- **WHEN** a caller omits a key or presents an invalid, revoked, or inactive user's key
- **THEN** MCP rejects the request without invoking Knowledge tools

### Requirement: Request-scoped stdio lifetime

For each authenticated MCP POST, AMS SHALL connect the official SDK stateless HTTP transport to one isolated unchanged stock stdio process. The process SHALL receive only that request's caller credential and native connection settings. Completion, client abort or failure SHALL close the request's transports and terminate its child. Independent requests SHALL not keep another request's child alive. AMS SHALL retain no credential groups, leases, session maps, idle subprocesses or TTL/reaper. The gateway SHALL allow at most 64 active stdio children globally. Before admitting a request beyond that limit, it SHALL terminate and fully release the oldest active request process, then start the new request; newer active requests SHALL remain unaffected. Responses SHALL use JSON and SHALL NOT issue Mcp-Session-Id. GET and DELETE SHALL return HTTP 405; standard notifications SHALL follow SDK stateless handling. Native initialization metadata and tool results, including isError, SHALL be forwarded; protocol error code and data SHALL remain intact with SDK message formatting permitted. Tool behavior and schemas SHALL remain upstream-owned; unsupported stateful capabilities SHALL not be emulated by restoring persistent sessions.

#### Scenario: Complete a tool request
- **WHEN** an authenticated POST completes its native response
- **THEN** its stock stdio process and request transports close
- **AND** a later POST creates its own process and rechecks the caller

#### Scenario: Abort with a sibling request active
- **WHEN** a caller disconnects while another POST remains active, including under the same credential
- **THEN** the disconnected request's child is terminated independently
- **AND** the sibling request continues with its own isolated child

#### Scenario: Request initialization or forwarding fails
- **WHEN** request processing fails after its child starts
- **THEN** AMS closes that request's transports and terminates its child without retaining a failed session

#### Scenario: Admit a request at process capacity
- **WHEN** 64 authenticated MCP requests have active stdio children and another authenticated POST arrives
- **THEN** AMS terminates and releases the oldest active request process before starting the new child
- **AND** the displaced request receives HTTP 503 when its response has not started
- **AND** the other 63 active requests continue with their existing isolated children

### Requirement: Protected Knowledge tool contract

MCP SHALL expose the stock tool names and schemas. The unchanged stdio child SHALL reach Knowledge through the AMS access boundary, which preserves the caller Bearer credential and supplies the native x-tdai-service-id header on supported stock routes. A local protected gateway SHALL remain internal to Compose by default; local MCP SHALL NOT require Knowledge host-port publication. Panel SHALL use stock Knowledge directly; AMS tool authorization SHALL remain a separate external boundary. Resource-specific tool requests SHALL carry the identifiers required by the stock schemas and enforce existing asset, team and user permissions. Stock tools/list SHALL remain available after authentication without imposing the removed generic two-tool schema. It SHALL NOT expose raw administrative Wiki or CodeGraph routes as an authorization bypass.

#### Scenario: Invoke an allowed resource tool
- **WHEN** an authenticated user requests a tool for a Knowledge resource they can use
- **THEN** the protected interface checks that user's access and executes the tool with the existing resource context

#### Scenario: Resource is outside the user's access
- **WHEN** a user lists or calls tools for a resource outside their active team or permissions
- **THEN** the existing Knowledge authorization boundary denies the request
- **AND** MCP does not retry it using elevated credentials

### Requirement: Connection metadata and acceptance boundary

Saved installation configuration SHALL identify MCP’s resolved saved host port for the separate connection-information workflow. Configuration SHALL distinguish desired state from evidence that containers started. Acceptance at this stage SHALL be limited to building required images and starting the complete stack; functional evidence SHALL be recorded separately for the selected stock revision and actual tested backends.

#### Scenario: Read connection information
- **WHEN** the connection-information workflow reads a saved installation with MCP configured
- **THEN** it can obtain the configured MCP port without prompting for agent configuration or retrieving a user's secret
- **AND** a successful build and start is not presented as full MCP or agent validation
