## MODIFIED Requirements

### Requirement: Complete interactive server configuration

Interactive setup SHALL display the initial menu. After the operator chooses Configure stack, it SHALL check for a complete visible AMS container group before any configuration question. A detected complete stack SHALL produce .env guidance and a successful early exit without prompting for an administrator key or reading credentials. This short-circuit SHALL NOT inspect or classify Core initialization state. Explicit apply SHALL remain available with the Core-state-based bootstrap behavior defined by deployment-composition; the guard SHALL NOT remove that command or add administrator recovery.

When no complete stack is detected, setup SHALL ask for the internal model source when a local CLIProxyAPI and local Core or Knowledge are configured. It SHALL offer `Use this stack's CLIProxyAPI` and `Connect another model API`, selecting the first for a fresh installation. It SHALL ask for actual LLM endpoint/API key only for the external source, and separate memory and Knowledge models for consumed services. Local model questions SHALL follow selected-provider authorization during apply. Setup SHALL also ask for the account provider for local CLIProxyAPI and remaining interactive operational settings. It SHALL use `homedir()/.agent-memory-stack` for configuration without a directory question. It SHALL manage `DATA_DIR` through `.env` without a data-directory question, defaulting to `./data` relative to the Compose configuration directory and preserving any saved value exactly. It SHALL derive fresh local topology, stack origins, and host ports without questions and preserve advanced .env configuration. Local Core/CLIProxyAPI service keys SHALL be reused or generated automatically; remote credentials SHALL require explicit configuration. Existing secrets SHALL remain masked. The server .env SHALL remain the editable source for persistent settings, with generated service configurations derived from it and resolved ports persisted during apply.

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

#### Scenario: Fresh shared model access
- **WHEN** a fresh full-stack installation accepts the local CLIProxyAPI source
- **THEN** setup derives internal API access without endpoint or key prompts
- **AND** it explains that missing Core and Knowledge model choices follow account authorization during application

#### Scenario: Select the account before the internal model source
- **WHEN** setup includes local CLIProxyAPI and a local Core or Knowledge consumer
- **THEN** it SHALL ask for the CLIProxyAPI account provider before `Models for memory and Knowledge`
- **AND** account authorization and missing local model selections remain part of apply

#### Scenario: Apply the account provider already selected in setup
- **WHEN** the user selects a CLIProxyAPI account provider and accepts `Apply configuration now?`, or later runs standalone apply
- **THEN** apply SHALL use the saved `CLIPROXY_AUTH_PROVIDER` without another provider-selection prompt
- **AND** matching saved authorization SHALL skip login, while missing authorization SHALL start login for that provider
- **AND** authorization belonging to another provider SHALL NOT skip the selected provider's login

#### Scenario: Preserve existing internal routing
- **WHEN** saved settings have an explicit provider base and key but no internal source metadata
- **THEN** the existing external-source behavior and exact credentials are preserved rather than changed to the new default

### Requirement: Independent internal LLM routing

Panel startup SHALL preserve the selected Core/Knowledge LLM configuration. Internal source SHALL be recorded as `INTERNAL_LLM_SOURCE=cliproxy|external`. In cliproxy mode, Core and Knowledge SHALL use this installation's local CLIProxyAPI service, with its internal API base and current service key derived automatically. In external mode they SHALL use the operator-configured LLM base and key. Both modes SHALL retain separate memory and Knowledge model choices, independent of the model in agent requests. Provider-issued credentials SHALL retain their original contents. Retained external values SHALL be inactive in cliproxy mode and SHALL NOT override derived access. When a local Core or Knowledge consumer exists, this mode SHALL require local CLIProxyAPI. Retained inactive source metadata SHALL NOT create a dependency for deployments without local internal consumers. This mode SHALL NOT publish another host interface.

#### Scenario: Panel restart preserves Z.ai routing
- **WHEN** Panel restarts and a subsequent Wiki ingestion runs
- **THEN** the request reaches the configured internal LLM endpoint with the Knowledge model
- **AND** it does not depend on an online client or replace the binding with the agent model

#### Scenario: Share access while keeping model choices separate
- **WHEN** local mode has authorized CLIProxyAPI and different configured Core and Knowledge model names
- **THEN** both consumers target `http://cli-proxy-api:8317/v1` with the current CLIProxyAPI service key and their respective model names
- **AND** the agent model remains determined by its own request

#### Scenario: Rotate the shared service key
- **WHEN** an operator changes CLIPROXY_API_KEY and applies local mode
- **THEN** generated internal consumer credentials follow the new key without a second key edit

#### Scenario: Local source loses its dependency
- **WHEN** local internal source is selected for a local Core or Knowledge consumer but CLIProxyAPI is absent from the installation
- **THEN** validation identifies the incompatible source and service selection without adding services or silently changing providers

### Requirement: User-owned reverse proxy and independent external URLs

Setup SHALL derive local MemoryProxy and Panel origins and MCP connection metadata automatically without asking for stack addresses or ports. Knowledge HTTP origins SHALL be used for agent access only in an explicitly exposed advanced configuration. Application SHALL resolve preferred host ports using the automatic allocation contract. Generated local origins SHALL follow resolved ports; saved operator origins SHALL retain their independently configured HTTP/HTTPS schemes and hostnames. External domains SHALL remain editable in .env. The package SHALL show resolved port-to-service mappings and required path/streaming behavior without managing Caddy, firewall rules, DNS, TLS, or an ingress service.

Each external origin SHALL exclude credentials, API paths, queries, and fragments. Generated API bases SHALL add the documented path exactly once. External provider API bases SHALL preserve their API prefix and remain explicit interactive inputs. Internal cliproxy mode SHALL derive its provider base without an endpoint prompt. Fresh preferred host ports remain 8096 for MemoryProxy and 8123 for Panel; MCP uses its configured default once implemented. Knowledge tools port 8422 SHALL remain an advanced explicit opt-in. Remote-agent guidance SHALL explain Caddy forwarding of the three default entry points with request paths preserved.

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
