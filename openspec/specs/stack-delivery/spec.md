# stack-delivery Specification

## Purpose

Deliver a modular npm package with stack setup, pinned container images, and a verifiable configuration and data lifecycle.

## Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing the executable `ams`. Running `ams` SHALL offer Configure stack and Apply configuration, with Configure stack selected initially. Each action SHALL require explicit selection. Setup and its existing-stack detection SHALL begin only after the operator selects Configure stack. Apply configuration SHALL use the same saved-target application workflow as standalone `ams apply`, without a server or path argument and without entering the setup wizard or its detection guard. Saved settings SHALL also remain applicable through the immediate-apply prompt. Connect an agent SHALL remain a separate planned action until its implementation is delivered. The package SHALL contain the compiled CLI and the templates/runtime assets needed by setup and application; execution SHALL not depend on the source checkout or developer sibling repositories. Release artifacts SHALL exclude real credentials and runtime data.

#### Scenario: Install the packed package
- **WHEN** the operator installs the locally produced npm archive into an isolated directory
- **THEN** the installed ams offers Configure stack and Apply configuration and waits for selection with Configure stack selected initially
- **AND** required templates resolve relative to the installed package while user output is written to the saved or selected installation directory

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs ams apply
- **THEN** both paths use the same remembered target and application workflow without a server argument, configuration questions, or the Configure stack detection guard

### Requirement: Modular TypeScript and interaction boundary

Authored application code SHALL use TypeScript with strict type checking. CLI presentation, setup workflows, configuration, runtime integration and build delivery SHALL have distinct responsibilities. Clack interaction SHALL be replaceable in workflow tests without a terminal. The selected stable `@clack/prompts` version SHALL be verified when added and pinned with its dependency lock.

#### Scenario: Validate package implementation
- **WHEN** the package is built and checked
- **THEN** strict TypeScript validation passes, the compiled CLI is executable and the setup workflow can be exercised through a test interaction adapter

### Requirement: Explicit interactive configuration and cancellation

Setup SHALL request the interactive settings consumed by the selected deployment, offer defaults for operational choices, and ask for real provider credentials and endpoints. Missing locally owned Core and CLIProxyAPI service keys SHALL be generated automatically; existing keys SHALL be reused without keep, generation, or manual-entry questions. These keys SHALL be saved only at the existing configuration-save boundary and SHALL remain stable across question navigation. Explicit .env keys SHALL remain authoritative. Advanced token limits and LLM timeouts SHALL remain editable in `.env` using the upstream deployment defaults without wizard questions. Secret input SHALL be masked; configuration review and routine diagnostics SHALL redact secret values. The intentional initial admin-key handoff is the documented exception. Cancellation before saving SHALL not deploy services or replace an existing configuration. Cancellation after saving SHALL retain the saved desired settings without replaying installation effects.

Setup SHALL explain automatically derived local service addresses and apply-time port allocation without asking for stack URLs, ports, service selection, remote placement, or interface enablement. External domains and advanced networking SHALL remain editable through .env. Saving alone SHALL require neither a running engine nor port allocation. Saved non-secret values SHALL take precedence over fresh defaults; remaining interactive values SHALL be offered for reuse.

#### Scenario: Cancel the wizard
- **WHEN** the user cancels before saving setup
- **THEN** existing configuration and running services remain unchanged
- **AND** transient secrets are not written to files

#### Scenario: Defer application after saving
- **WHEN** the user declines immediate application or cancels after configuration is saved
- **THEN** the saved desired settings remain available for `ams apply`
- **AND** no installation work is started or replayed by cancellation

#### Scenario: Repeat with existing credentials
- **WHEN** setup reads existing Core and CLIProxyAPI service keys
- **THEN** setup reuses their exact values without confirmation or exposing them in prompts or review output
- **AND** administrator, provider, and remote-service credentials retain their separate contracts

#### Scenario: Generate missing internal keys
- **WHEN** a configured local Core or CLIProxyAPI has no saved service key
- **THEN** setup generates its independent key without asking a question and preserves it across back navigation
- **AND** cancellation before saving does not persist it, while saving records it in .env for reuse

### Requirement: One editable server environment file

Persistent server settings SHALL be maintained through one `.env`; generated JSON/YAML files SHALL be derived artifacts. Applying changed settings SHALL regenerate dependent configurations and recreate affected containers as needed. A plain container restart SHALL NOT be described as reloading Compose environment values. The initial administrator credential SHALL not be persisted in this file.

#### Scenario: Apply a new model or endpoint
- **WHEN** the user changes the model or endpoint in `.env` and performs the documented apply operation
- **THEN** consumers use the updated settings without manual generated-config edits
- **AND** the operation does not recreate the administrator or rotate existing service secrets

#### Scenario: Preserve literal provider keys
- **WHEN** a provider key contains supported quote, backslash or dollar characters
- **THEN** the consuming service receives its exact value without shell execution or recursive interpolation

### Requirement: Independent generated keys and secret handling

Generated stack keys SHALL use `sk-ams-<purpose>-<64 lowercase hexadecimal characters>` with an independently generated 32-byte random suffix per role. Roles SHALL include administrator, Core service access and CLIProxyAPI access. Provider-issued and operator-supplied keys SHALL retain their supplied value. Persistent service credentials and OAuth files SHALL use restricted permissions and be excluded from Git, npm archives and image build contexts. The setup program SHALL not persist a separate admin-key copy; that identity remains in Core's database after initialization.

#### Scenario: Prepare service credentials
- **WHEN** the user accepts generated internal API keys
- **THEN** their values are independent and stored in the server configuration for reuse
- **AND** repeated setup does not replace them without an explicit credential change

#### Scenario: Inspect distributable contents
- **WHEN** the npm archive or container build context is inspected
- **THEN** real `.env`, authorization files, generated secret-bearing configurations and application data are absent

### Requirement: Pinned images and separate build lifecycle

Build definitions SHALL record immutable upstream revisions, dependency locks, base-image identities and output image platform/content identities. Application SHALL reuse verified prepared images and automatically build missing required images from pinned sources before runtime initialization. Container startup itself SHALL use the prepared images without compiling services. Images SHALL remain separately deliverable from the npm archive, with a documented load and identity-verification path for offline installation without source downloads or compilation on the target host. Third-party licenses and source provenance SHALL be included.

#### Scenario: Build and deliver images
- **WHEN** images are produced from the recorded inputs
- **THEN** the build verifies source identities and dependencies and records the resulting platform/content identities
- **AND** the runtime package can use them on a compatible host without a sibling checkout

#### Scenario: Source or platform mismatch
- **WHEN** downloaded source fails integrity verification or an image targets an incompatible architecture
- **THEN** the relevant build/deployment check fails explicitly before service initialization

### Requirement: Persistent lifecycle and consistent recovery

The delivery SHALL identify all authoritative application data, including Core metadata/credential database, memory, Knowledge, persistent Panel/Proxy state and server OAuth. Restart and container recreation SHALL retain this state. Backup/restore SHALL include a consistent application data set and matching persistent service configuration. User-owned Caddy and TLS state SHALL remain outside this package's backup responsibility. OAuth recovery checks SHALL use one active refresher for the restored account.

#### Scenario: Restart without bootstrap secret
- **WHEN** initialized services are restarted or recreated from existing state
- **THEN** data and administrator identity remain usable without the initial setup key being supplied again

#### Scenario: Restore a backup
- **WHEN** a consistent backup is restored into isolated storage with compatible images and service settings
- **THEN** saved conversations, Knowledge assets and the existing administrator identity remain available
- **AND** the source installation's data is unchanged

### Requirement: Build and container startup acceptance

The current delivery stage SHALL have one acceptance criterion: the required container images have been built and the selected Compose containers have been started. Long-running services SHALL remain running at the recorded observation point, and required one-shot initialization containers SHALL complete successfully. The record SHALL identify the tested image set, platform, and container runtime. Comprehensive functional validation SHALL be scheduled after Supergateway and the remaining integration work; it SHALL NOT be a completion gate for this delivery stage.

#### Scenario: Accept the container delivery stage
- **WHEN** the required images build successfully and the selected containers start
- **THEN** the build-and-start acceptance criterion is satisfied for that recorded environment
- **AND** agent requests, MCP, provider authorization, memory/Wiki behavior, and full recovery remain subjects of later comprehensive validation

#### Scenario: Image build or container startup fails
- **WHEN** a required image cannot be built, a required long-running container cannot stay running, or a required initialization job fails
- **THEN** build-and-start acceptance remains incomplete and records the failing stage

### Requirement: Runtime claims match tested environments

Documentation SHALL name the actual OS, CPU architecture, container engine and Compose provider used for validation. Commands SHALL use public runtime interfaces directly rather than depend on shell aliases. Prerequisite and permission failures SHALL identify the failing stage without claiming deployment success.

#### Scenario: Unsupported runtime prerequisite
- **WHEN** Compose support, required filesystem permissions or an image platform is unavailable
- **THEN** setup reports the prerequisite failure before initialization changes application data
