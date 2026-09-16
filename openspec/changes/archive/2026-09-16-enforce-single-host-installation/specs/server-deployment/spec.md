## MODIFIED Requirements

### Requirement: Complete interactive server configuration

Interactive setup SHALL display the initial menu. After the operator chooses Configure stack, it SHALL check for a complete visible AMS container group before any configuration question. A detected complete stack SHALL produce .env guidance and a successful early exit without prompting for an administrator key or reading credentials. This short-circuit SHALL NOT inspect or classify Core initialization state. Explicit apply SHALL remain available with the application-container-based bootstrap behavior defined by deployment-composition; the guard SHALL NOT remove that command or add administrator recovery.

When no complete stack is detected, setup SHALL ask for actual LLM endpoint/API key, separate memory and Knowledge models, the account provider for local CLIProxyAPI, data location, and remaining interactive operational settings. It SHALL derive fresh local topology, stack origins, and host ports without questions and preserve advanced .env configuration. Local Core/CLIProxyAPI service keys SHALL be reused or generated automatically; remote credentials SHALL require explicit configuration. Existing secrets SHALL remain masked. The server .env SHALL remain the editable source for persistent settings, with generated service configurations derived from it and resolved ports persisted during apply.

#### Scenario: Configure Z.ai and ChatGPT
- **WHEN** the guard permits setup and the operator supplies a Z.ai endpoint, API key, and model names
- **THEN** Core and Knowledge use those settings for internal processing independently of the agent model
- **AND** CLIProxyAPI uses its server account authorization and internal API credential, without requiring a fabricated ChatGPT API key or provider URL

#### Scenario: Repeat setup
- **WHEN** the operator chooses Configure stack and setup finds all five application containers in one visible AMS project
- **THEN** it directs the operator to the existing .env and exits before configuration or administrator questions
- **AND** configuration, credentials, and container state remain unchanged

#### Scenario: Partial or deferred installation
- **WHEN** the container check finds no complete stack and setup reads saved settings
- **THEN** the ordinary wizard preserves those settings and reports missing or invalid required values by field name without revealing secrets

#### Scenario: Apply new configuration with older images
- **WHEN** the saved runtime or application image was built from different package inputs or lacks build provenance
- **THEN** application rebuilds the required outdated image before stopping services or running configuration generation
- **AND** identical current images loaded from a bundle remain reusable without downloading source archives

### Requirement: Server-owned OAuth

CLIProxyAPI SHALL persist account authorization on the machine hosting its local container. Setup SHALL offer ChatGPT (Codex) and Claude account setup, saved as CLIPROXY_AUTH_PROVIDER=codex or claude with codex as the compatibility default. Existing installations SHALL be able to edit that value in .env and apply it. This selection SHALL affect account setup only, preserving model routing and authorization files for other providers.

Before offering login, application SHALL inspect local saved authorization with read-only file access and no network access. A matching record SHALL have the selected provider type, SHALL NOT be disabled, and SHALL contain an access or refresh credential. A different provider's credentials or a nonempty model list SHALL NOT satisfy this check. Inspection failures SHALL be reported as failures rather than missing authorization. Matching saved credentials SHALL skip optional login without claiming token freshness or successful inference.

ChatGPT (Codex) SHALL use no-browser device login. Claude SHALL use no-browser login with manual entry of the complete final localhost callback URL after browser sign-in; guidance SHALL explain the 15-second terminal prompt, possible browser connection-refused page, and that empty Enter does not submit the callback. The hosting machine SHALL require neither a browser nor an inbound callback port. After either login, application SHALL recheck persisted selected-provider authorization before reporting success, even when the login process exits zero. Reauthorization and token refresh SHALL preserve the same state directory.

#### Scenario: First account login
- **WHEN** no matching selected-provider authorization exists and the user chooses to log in
- **THEN** application runs that provider's no-browser flow and reports success only after matching authorization is found in the saved state
- **AND** the server opens no host callback port and other providers' authorization remains intact

#### Scenario: Claude manual callback
- **WHEN** the user completes Claude browser sign-in and reaches the final localhost callback URL
- **THEN** guidance directs them to paste that full URL into the terminal prompt that appears after 15 seconds, even if the browser cannot connect
- **AND** guidance does not instruct them to submit a blank line

#### Scenario: Login exits without matching credentials
- **WHEN** the provider login process exits zero but the selected-provider authorization check still finds no matching credential
- **THEN** application reports unsuccessful authorization instead of login success

#### Scenario: Recreate CLIProxyAPI
- **WHEN** its container is recreated
- **THEN** it reuses persisted OAuth authorization on the host service's state directory without client-side token files or deleting other provider accounts

## ADDED Requirements

### Requirement: Clear listener audience labels

Application output SHALL label the implemented user-facing listeners as MemoryProxy (agent API) and Panel (web interface), using their actual saved addresses or ports. These labels SHALL NOT introduce new protocol routes or alter the approved separate connection-information message.

#### Scenario: Read applied listener addresses
- **WHEN** application prints the configured user-facing listeners
- **THEN** their labels identify MemoryProxy as the agent API and Panel as the web interface
