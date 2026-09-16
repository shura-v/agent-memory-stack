## Purpose

Deploy selected memory services and model proxies in one Compose project per machine, with controlled initialization, loopback entry points, and processing independent of agent availability.

## ADDED Requirements

### Requirement: One server Compose with loopback entry points

The delivery SHALL provide one Compose project per installation, containing the applications selected according to the deployment-composition specification and their required initialization/access services. The default full selection contains MemoryCore, MemoryKnowledge, MemoryPanel, MemoryProxy and CLIProxyAPI. User-facing MemoryProxy, authenticated Knowledge tools and Panel ports, and explicitly enabled authenticated service interfaces, SHALL bind to `127.0.0.1`. Raw Knowledge SHALL remain inside the Compose network. The stack SHALL allow the outbound connections required for LLM calls and OAuth.

#### Scenario: Start the server stack
- **WHEN** the operator starts the configured server project with all applications selected and no optional service interfaces
- **THEN** all five application services and required support services run in that project with explicit readiness dependencies
- **AND** only the three documented loopback entry points are published on the host

#### Scenario: Reach the host from another machine
- **WHEN** another machine connects directly to a published stack port on the VPS network address
- **THEN** it cannot bypass the loopback boundary
- **AND** no wildcard IPv4 or IPv6 host binding is introduced

#### Scenario: Client is offline
- **WHEN** all services are on the server and the developer closes the agent or turns off the client computer
- **THEN** server services and internal LLM processing remain available

### Requirement: User-owned reverse proxy and independent external URLs

Setup SHALL ask separately for each MemoryProxy, Knowledge and Panel origin consumed by the selected deployment and SHALL preserve different hostnames. These URLs SHALL describe client access directly over HTTP or HTTPS, or through the user's own reverse proxy. The package SHALL provide a port-to-service mapping and required path/streaming behavior without installing, editing or reloading Caddy, opening firewall ports, changing DNS or managing TLS certificates. Compose SHALL NOT contain an ingress or certificate-management service.

Each external service URL SHALL be an HTTP or HTTPS origin, without credentials, an API path, query or fragment. Generated API bases SHALL add the documented protocol path exactly once. The user-owned proxy SHALL preserve that request path. The LLM provider base URL SHALL separately preserve the provider's API prefix.

Setup server SHALL ask for loopback ports before service origins. For each origin without a saved value, it SHALL suggest `http://127.0.0.1:<selected-port>`, using initial ports `8096`, `8422` and `8123` for MemoryProxy, Knowledge and Panel. Saved URLs SHALL take precedence over computed defaults, including when a port changes. Before URL prompts, setup SHALL explain accepting local HTTP with Enter for same-machine access and replacing it with reachable server addresses for remote access.

#### Scenario: Fresh setup with custom ports
- **WHEN** the operator chooses custom loopback ports before answering the service URL prompts
- **THEN** each suggested local HTTP origin uses the corresponding selected port
- **AND** accepting the suggestions requires no reverse proxy or certificate setup

#### Scenario: Existing service URL with a changed port
- **WHEN** an installation already has a saved service URL and the operator changes its loopback port
- **THEN** the saved URL remains the suggested value for explicit reuse or replacement
- **AND** setup does not silently replace it with a computed local origin

#### Scenario: Local HTTP service origins
- **WHEN** the user supplies HTTP origins with localhost, an IP address or another hostname and explicit ports
- **THEN** setup accepts them and preserves the selected scheme in generated service and client URLs
- **AND** HTTPS URLs retain certificate verification and published container ports remain bound to loopback

#### Scenario: Three unrelated domains
- **WHEN** the user enters three different external hostnames
- **THEN** generated connection information and tool instructions use the corresponding exact service URL
- **AND** no shared domain zone or derived hostname is required

#### Scenario: Construct tool and model URLs
- **WHEN** setup receives valid service origins and the provider API base
- **THEN** Knowledge tools use one `/v3` prefix and the selected model client uses its documented API base plus one operation suffix
- **AND** malformed origins or already-appended operation endpoints are rejected rather than producing doubled prefixes

#### Scenario: Caddy is not configured yet
- **WHEN** the local stack is ready but its external URLs are unreachable
- **THEN** readiness reports local services and external connectivity separately
- **AND** setup does not publish another interface or modify host networking as a fallback

### Requirement: Complete interactive server configuration

Setup server SHALL ask for the exposed settings consumed by the selected deployment, including actual LLM endpoint/API key, separate memory and Knowledge models, external service URLs, loopback ports and data location. Defaults SHALL be offered for known operational values and generated service keys; external account credentials SHALL require user input. Existing settings SHALL be offered for reuse, with secret values masked. The server `.env` SHALL be the editable source for persistent service settings, and generated service configurations SHALL be derived from it.

#### Scenario: Configure Z.ai and ChatGPT
- **WHEN** the operator supplies a Z.ai endpoint, API key and model names
- **THEN** Core and Knowledge use those settings for internal processing independently of the agent model
- **AND** CLIProxyAPI uses its server account authorization and internal API credential, without requiring a fabricated ChatGPT API key or provider URL

#### Scenario: Repeat setup
- **WHEN** setup is run for an existing installation
- **THEN** it reuses confirmed settings and existing service keys without silently generating replacements
- **AND** missing or invalid required values are reported by field name without revealing secrets

### Requirement: Transient initial administrator credential

For a fresh installation owning local Core, Setup server SHALL offer an operator-supplied admin key or generate one by default. Before administrator creation it SHALL show the resulting key in a dedicated interactive handoff with an opportunity to copy it or cancel setup. The key SHALL be passed to initialization through a transient channel and SHALL NOT be saved by the setup program in `.env`, `.admin-key`, generated files, command arguments, container environment or routine logs. Core's own credential database SHALL retain the created identity as required by its authentication model.

#### Scenario: Generated default key
- **WHEN** the operator accepts generation and proceeds after the key is displayed
- **THEN** bootstrap creates the administrator with exactly that key and verifies authentication, default team and default agent
- **AND** no extra copy of the bootstrap key is written to deployment files

#### Scenario: Operator supplies a key
- **WHEN** the operator enters a valid custom admin key
- **THEN** setup passes that exact value to Core without regenerating it or requiring the generated-key prefix

#### Scenario: Cancel before initialization
- **WHEN** the operator cancels setup or declines the key handoff
- **THEN** no administrator is created and no supplied/generated admin key is persisted by setup

#### Scenario: Restart an initialized installation
- **WHEN** the configured server is restarted with existing administrator data
- **THEN** normal startup does not require the transient setup key and does not recreate or rotate the administrator

#### Scenario: Partial initialization or conflict
- **WHEN** the initialization attempt returns an existing-user conflict or incomplete default entities
- **THEN** setup verifies the supplied key before any authenticated repair and reports failure if it does not match
- **AND** existing data is preserved; a conflict alone is not treated as successful first-time initialization

### Requirement: Server-owned OAuth

CLIProxyAPI SHALL persist account authorization on the machine that hosts its selected local container. Setup SHALL support Codex device-code login, displaying the provider verification URL and code for approval in a browser on the user's computer. The hosting machine SHALL require neither a browser nor an inbound OAuth callback port. Reauthorization and token refresh SHALL preserve the same server state directory.

#### Scenario: First account login
- **WHEN** the user starts account authorization
- **THEN** successful device approval saves authorization on the server
- **AND** failure or unsupported device flow is reported explicitly without silently opening callback ports

#### Scenario: Recreate CLIProxyAPI
- **WHEN** its container is recreated
- **THEN** it reuses and refreshes the persisted OAuth authorization without client-side token files

### Requirement: Independent internal LLM routing

Panel startup SHALL preserve the direct Core/Knowledge LLM configuration. Server memory and Wiki processing SHALL use the configured internal provider rather than the agent's CLIProxyAPI model. Provider-issued credentials SHALL retain their original contents.

#### Scenario: Panel restart preserves Z.ai routing
- **WHEN** Panel restarts and a subsequent Wiki ingestion runs
- **THEN** the request reaches the configured internal LLM endpoint with the Knowledge model
- **AND** it does not depend on an online client or replace the binding with the agent model

### Requirement: Authenticated exposed APIs and private operations

Loopback model/tool endpoints SHALL enforce application authentication even when accessed directly on the VPS. Knowledge and memory/skill tools SHALL enforce the caller's permitted team/assets and session identity. Bootstrap, destruction, account-file management and internal administration SHALL remain outside the exposed method/path allowlist. Panel SHALL use its normal user authentication.

#### Scenario: Invalid credential or unauthorized asset
- **WHEN** a caller supplies an invalid key, another user's session or an inaccessible asset
- **THEN** the exposed endpoint rejects the operation before protected content is returned

#### Scenario: Internal administration through an exposed port
- **WHEN** a caller requests Core initialization/destruction, CLIProxyAPI management or another internal-only route through a user-facing entry point
- **THEN** the operation is rejected regardless of the caller's ordinary user key

### Requirement: Streaming and readiness remain observable

The exposed model path SHALL preserve incremental responses and the transports used by the configured agent, propagate cancellation and avoid replaying an already accepted model request. Service readiness SHALL be reported separately from account authorization, external proxy availability and semantic memory checks.

#### Scenario: Stream and cancel
- **WHEN** the user begins a streaming model request and cancels after receiving output
- **THEN** incremental output is visible and cancellation reaches the model proxy without duplicate submission

### Requirement: Authenticated agent requests and URLs

The client model request SHALL authenticate as the selected memory user; the CLIProxyAPI credential SHALL remain server-side. The selected model SHALL be passed in the client's model request. Client-facing URLs SHALL use the supplied HTTP or HTTPS service origins, including direct local HTTP access and SHALL use certificate verification for HTTPS. Authentication diagnostics SHALL distinguish the memory user, model account and internal service connection.

#### Scenario: Model account is unavailable
- **WHEN** the memory user authenticates but the server model account is expired or unavailable
- **THEN** the diagnostic identifies the model authorization/connection stage without reporting successful model access

#### Scenario: TLS cannot be verified
- **WHEN** an external endpoint presents an invalid certificate
- **THEN** the connection fails without silently disabling verification

### Requirement: Preserve conversation and asset identity

Requests SHALL associate the authenticated user with the selected team, agent and conversation. New conversations SHALL use distinct identifiers and resume SHALL explicitly reuse the existing conversation. A task identifier SHALL remain optional when the upstream session contract permits it.

#### Scenario: Request without a task identifier
- **WHEN** an authorized request selects a valid team and agent without `x-task-id`
- **THEN** it can initialize the session, receive a model response and persist the conversation

#### Scenario: Save and resume conversation
- **WHEN** the agent completes a request and later resumes the same conversation
- **THEN** user and assistant messages are retrievable in Core/Panel under that identity
- **AND** a newly created session remains a separate conversation

### Requirement: Authenticated tool instructions without embedded secrets

The model SHALL receive usable memory and skill instructions and, when Knowledge is enabled, Knowledge instructions with the supplied external URLs. Generated instructions SHALL refer to the client's credential through a documented environment variable instead of embedding its value. Tool execution SHALL validate the authenticated caller, session ownership where applicable, active team membership and asset permissions before returning content. Caller-provided identity fields SHALL NOT grant access on their own.

#### Scenario: Knowledge request from the agent environment
- **WHEN** the agent executes an injected tool command with its configured credential environment
- **THEN** the request reaches the specified Knowledge entry point and can read an authorized asset
- **AND** the actual model request contains the instructions without a real credential value

#### Scenario: Different user or revoked membership
- **WHEN** a user requests another user's private asset/session or has lost the required membership/grant
- **THEN** protected tools reject the request and no unauthorized asset text is returned

#### Scenario: Codex instructions field
- **WHEN** the client supplies Responses instructions as a string
- **THEN** injected content reaches the final model-visible instructions while preserving the original instructions and input
- **AND** Proxy logs alone are not accepted as proof of injection

### Requirement: Standalone forwarding defaults

The stack SHALL accept models supported by its configured upstream without an unrelated sample pricing allowlist. Sample credit-reporting requests SHALL be disabled. Rate limiting SHALL be reported as disabled when no enforcing backend is configured.

#### Scenario: Forward a supported model
- **WHEN** the client selects an upstream-supported model outside the example pricing table
- **THEN** the request is forwarded without a sample-pricing rejection or demo usage-reporting call
