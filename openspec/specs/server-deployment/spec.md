# server-deployment Specification

## Purpose

Deploy selected memory services and model proxies in one Compose project per machine, with controlled initialization, loopback entry points, and processing independent of agent availability.

## Requirements

### Requirement: Installation-owned TDAI updates

`ams update tdai` SHALL use the same remembered installation as `ams apply`, download the current `feat/server_team` commit, and save its revision, archive URL, and SHA-256 in `.ams/tdai-source.json`. It SHALL then run the existing image preparation and apply workflow. This command SHALL work from the installed npm package without a Git checkout or submodule and SHALL leave packaged sources and CLIProxyAPI selection unchanged.

#### Scenario: Update an existing installation
- **WHEN** the operator runs `ams update tdai` with saved valid configuration containing TDAI services
- **THEN** source fetching, image fingerprints, and TDAI image revision labels use the installation's selected revision
- **AND** later `ams apply` invocations retain that revision until another update
- **AND** the settings snapshot preserves the previously applied source selection

#### Scenario: Source download fails
- **WHEN** GitHub commit resolution or archive download fails
- **THEN** the previous source selection remains unchanged and apply does not begin

### Requirement: One server Compose with loopback entry points

The delivery SHALL provide one Compose project per installation, containing the applications selected according to the deployment-composition specification and their required initialization/access services. The default full stack contains MemoryCore, MemoryKnowledge, MemoryPanel, MemoryProxy, CLIProxyAPI, and MCP once implemented. Only Panel, MemoryProxy, and MCP SHALL publish host ports by default, all on `127.0.0.1` and without enablement questions. Core, CLIProxyAPI, direct Knowledge HTTP tools, and Knowledge service interfaces SHALL remain internal unless an advanced .env override explicitly enables authenticated loopback exposure. MCP SHALL reach the protected Knowledge gateway over the Compose network. Raw Knowledge SHALL remain private. The stack SHALL allow the outbound connections required for LLM calls and OAuth.

#### Scenario: Start the server stack
- **WHEN** the operator starts the configured server project with all applications selected and no optional service interfaces
- **THEN** all configured application services, implemented MCP, and required support services run in that project with explicit readiness dependencies
- **AND** only Panel, MemoryProxy, and implemented MCP are published on loopback without exposure prompts

#### Scenario: Reach the host from another machine
- **WHEN** another machine connects directly to a published stack port on the VPS network address
- **THEN** it cannot bypass the loopback boundary
- **AND** no wildcard IPv4 or IPv6 host binding is introduced

#### Scenario: Client is offline
- **WHEN** all services are on the server and the developer closes the agent or turns off the client computer
- **THEN** server services and internal LLM processing remain available

### Requirement: User-owned reverse proxy and independent external URLs

Setup SHALL derive local MemoryProxy and Panel origins and MCP connection metadata automatically without asking for stack addresses or ports. Knowledge HTTP origins SHALL be used for agent access only in an explicitly exposed advanced configuration. Application SHALL resolve preferred host ports using the automatic allocation contract. Generated local origins SHALL follow resolved ports; saved operator origins SHALL retain their independently configured HTTP/HTTPS schemes and hostnames. External domains SHALL remain editable in .env. The package SHALL show resolved port-to-service mappings and required path/streaming behavior without managing Caddy, firewall rules, DNS, TLS, or an ingress service.

Each external origin SHALL exclude credentials, API paths, queries, and fragments. Generated API bases SHALL add the documented path exactly once. Provider API bases SHALL preserve their API prefix and remain explicit interactive inputs. Fresh preferred host ports remain 8096 for MemoryProxy and 8123 for Panel; MCP uses its configured default once implemented. Knowledge tools port 8422 SHALL remain an advanced explicit opt-in. Remote-agent guidance SHALL explain Caddy forwarding of the three default entry points with request paths preserved.

#### Scenario: Fresh setup with custom ports
- **WHEN** apply replaces busy default ports with available runtime ports
- **THEN** generated local origins use those resolved ports without URL or port questions
- **AND** local access requires no reverse proxy or certificates

#### Scenario: Existing service URL with a changed port
- **WHEN** an operator-configured external service URL exists and its host port is reassigned
- **THEN** the external URL is preserved and the new upstream port is reported

#### Scenario: Local HTTP service origins
- **WHEN** the user configures HTTP origins with localhost, an IP address or another hostname and explicit ports in .env
- **THEN** setup accepts them and preserves the selected scheme in generated service and client URLs
- **AND** HTTPS URLs retain certificate verification and published container ports remain bound to loopback

#### Scenario: Three unrelated domains
- **WHEN** the user explicitly enables direct Knowledge HTTP access and sets separate MemoryProxy, Knowledge, and Panel hostnames in .env
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

Interactive setup SHALL display the initial menu. After the operator chooses Configure stack, it SHALL check for a complete visible AMS container group before any configuration question. A detected complete stack SHALL produce .env guidance and a successful early exit without prompting for an administrator key or reading credentials. This short-circuit SHALL NOT inspect or classify Core initialization state. Explicit apply SHALL remain available with the Core-state-based bootstrap behavior defined by deployment-composition; the guard SHALL NOT remove that command or add administrator recovery.

When no complete stack is detected, setup SHALL ask for actual LLM endpoint/API key, separate memory and Knowledge models, the account provider for local CLIProxyAPI, data location, and remaining interactive operational settings. It SHALL derive fresh local topology, stack origins, and host ports without questions and preserve advanced .env configuration. Local Core/CLIProxyAPI service keys SHALL be reused or generated automatically; remote credentials SHALL require explicit configuration. Existing secrets SHALL remain masked. The server .env SHALL remain the editable source for persistent settings, with generated service configurations derived from it and resolved ports persisted during apply.

#### Scenario: Configure Z.ai and ChatGPT
- **WHEN** the guard permits setup and the operator supplies a Z.ai endpoint, API key, and model names
- **THEN** Core and Knowledge use those settings for internal processing independently of the agent model
- **AND** CLIProxyAPI uses its server account authorization and internal API credential, without requiring a fabricated ChatGPT API key or provider URL

#### Scenario: Repeat setup
- **WHEN** the operator chooses Configure stack and setup finds all five application containers in one visible AMS project
- **THEN** it directs the operator to the existing .env and exits before configuration or administrator questions
- **AND** configuration, credentials, and container state remain unchanged

#### Scenario: Apply new configuration with older images
- **WHEN** the saved runtime or application image was built from different package inputs or lacks build provenance
- **THEN** application rebuilds the required outdated image before stopping services or running configuration generation
- **AND** identical current images loaded from a bundle remain reusable without downloading source archives

#### Scenario: Partial or deferred installation
- **WHEN** the container check finds no complete stack and setup reads saved settings
- **THEN** the ordinary wizard preserves those settings and reports missing or invalid required values by field name without revealing secrets

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

Panel startup SHALL preserve the direct Core/Knowledge LLM configuration. Server memory and Wiki processing SHALL use the configured internal provider rather than the agent's CLIProxyAPI model. Provider-issued credentials SHALL retain their original contents.

#### Scenario: Panel restart preserves Z.ai routing
- **WHEN** Panel restarts and a subsequent Wiki ingestion runs
- **THEN** the request reaches the configured internal LLM endpoint with the Knowledge model
- **AND** it does not depend on an online client or replace the binding with the agent model

### Requirement: Authenticated APIs and operator-controlled exposure

Loopback model/tool endpoints SHALL enforce application authentication even when accessed directly on the VPS. Knowledge and memory/skill tools SHALL enforce the caller's permitted team/assets and session identity. MemoryProxy SHALL use native upstream routing without an AMS method/path/query allowlist. Panel SHALL use its normal user authentication. Published listeners SHALL retain their default loopback bindings. The operator SHALL control network exposure through their own reverse proxy and firewall; AMS SHALL NOT install route restrictions in Caddy.

#### Scenario: Invalid credential or unauthorized asset
- **WHEN** a caller supplies an invalid key, another user's session or an inaccessible asset
- **THEN** the exposed endpoint rejects the operation before protected content is returned

#### Scenario: Native agent request with query parameters
- **WHEN** an authenticated agent sends a request such as `/claude-code/ams/v1/messages?beta=true`
- **THEN** AMS passes the request to MemoryProxy's native handlers without filtering or rewriting its path, method, query, or body

#### Scenario: Operator publishes a service
- **WHEN** the operator adds the documented Caddy reverse proxy for a service
- **THEN** that service's native routes remain reachable subject to application authentication
- **AND** any additional network or route restrictions belong to the operator's configuration

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

The model SHALL receive usable memory and skill instructions. Knowledge tools SHALL be available to agents through MCP in the default deployment, with server-side access to the internal protected Knowledge gateway. Direct Knowledge HTTP tool instructions SHALL be emitted only when direct HTTP exposure is explicitly enabled and an agent-reachable origin is configured; internal-only Knowledge SHALL NOT be advertised as a client-callable HTTP endpoint. Generated instructions SHALL refer to the client's credential through a documented environment variable instead of embedding its value. Tool execution SHALL validate the authenticated caller, session ownership where applicable, active team membership and asset permissions before returning content. Caller-provided identity fields SHALL NOT grant access on their own.

#### Scenario: Knowledge request from the agent environment
- **WHEN** direct Knowledge HTTP exposure is explicitly enabled and the agent executes an injected tool command with its configured credential environment
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

### Requirement: Clear listener audience labels

Application output SHALL label the implemented user-facing listeners as MemoryProxy (agent API) and Panel (web interface), using their actual saved addresses or ports. These labels SHALL NOT introduce new protocol routes or alter the approved separate connection-information message.

#### Scenario: Read applied listener addresses
- **WHEN** application prints the configured user-facing listeners
- **THEN** their labels identify MemoryProxy as the agent API and Panel as the web interface
