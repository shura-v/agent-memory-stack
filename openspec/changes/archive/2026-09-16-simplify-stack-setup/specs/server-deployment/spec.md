## MODIFIED Requirements

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

Setup SHALL ask for actual LLM endpoint/API key, separate memory and Knowledge models, data location, and remaining interactive operational settings. It SHALL derive fresh local service topology, stack origins, and host ports without questions. Existing advanced topology and networking settings SHALL be read from .env; incomplete settings SHALL be reported for manual correction. Defaults SHALL remain available for known operational values. Missing locally owned Core and CLIProxyAPI service keys SHALL be generated automatically and saved keys SHALL be reused without keep/generate/manual prompts; explicit .env values SHALL be honored without silent rotation. Remote service credentials SHALL remain explicit and external account credentials SHALL require user input. The administrator key for Panel SHALL retain its separate application flow. Existing secrets SHALL remain masked. The server .env SHALL remain the editable source for persistent settings, with generated service configurations derived from it and resolved ports persisted during apply.

#### Scenario: Configure Z.ai and ChatGPT
- **WHEN** the operator supplies a Z.ai endpoint, API key and model names
- **THEN** Core and Knowledge use those settings for internal processing independently of the agent model
- **AND** CLIProxyAPI uses its server account authorization and internal API credential, without requiring a fabricated ChatGPT API key or provider URL

#### Scenario: Repeat setup
- **WHEN** setup is run for an existing installation
- **THEN** it reuses confirmed settings and existing service keys automatically without service-key questions or silently generating replacements
- **AND** missing or invalid required values are reported by field name without revealing secrets

#### Scenario: Apply new configuration with older images
- **WHEN** the saved runtime or application image was built from different package inputs or lacks build provenance
- **THEN** application rebuilds the required outdated image before stopping services or running configuration generation
- **AND** identical current images loaded from a bundle remain reusable without downloading source archives

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
