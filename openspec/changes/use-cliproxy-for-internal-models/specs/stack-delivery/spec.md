> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

### Requirement: Explicit interactive configuration and cancellation

Setup SHALL accept text inputs without configured-value validators and retain its normal select-menu choices. It SHALL request the interactive settings consumed by the complete local stack, offer defaults for operational choices, and ask for real provider credentials and endpoints when an external internal-model source is selected. Local CLIProxyAPI mode SHALL derive its initial API access and ask for Core and Knowledge models during Configure stack without requiring provider authorization. Apply SHALL consume saved files without requesting or validating model values. Missing CLIProxyAPI service keys SHALL be generated automatically; existing keys SHALL be reused without keep, generation, or manual-entry questions. AMS SHALL NOT generate or initially seed Core server.apiKey. An operator-configured Core service key SHALL remain authoritative in native configuration. These keys SHALL be saved only at the existing configuration-save boundary and SHALL remain stable across question navigation. Persisted keys SHALL remain authoritative in their owning configuration files. Advanced native token limits and LLM timeouts SHALL remain editable in the corresponding partial native overrides, inheriting upstream defaults when absent, without additional wizard questions. Setup SHALL populate known installation values once in overrides while keeping defaults as exact complete upstream templates. Ordinary apply and update SHALL preserve override bytes; explicit wizard edits SHALL change only reviewed fields and preserve unrelated values. Configured values SHALL remain operator-owned; AMS SHALL check document integrity and report actual runtime failures without enforcing value policies. Secret input SHALL be masked; configuration review and routine diagnostics SHALL redact secret values. The intentional initial admin-key handoff is the documented exception. Cancellation before saving SHALL not deploy services or replace an existing configuration. Cancellation after saving SHALL retain the saved desired settings without replaying installation effects.

When the entered external model API base URL differs from its saved value, setup SHALL request a new API key directly instead of offering to keep the key associated with the previous endpoint. An unchanged base URL SHALL retain the existing-key confirmation.

Setup SHALL explain automatically derived local service addresses and apply-time port allocation without asking for stack URLs, ports, service selection, remote placement, or interface enablement. Native external origins and service networking SHALL remain editable through overrides; AMS publication and other orchestration choices SHALL remain editable through .env. Saving alone SHALL require neither a running engine nor port allocation. Saved non-secret values SHALL take precedence over fresh defaults; remaining interactive values SHALL be offered for reuse.

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
- **AND** administrator, provider, and service credentials retain their separate contracts

#### Scenario: Generate missing internal keys
- **WHEN** the local CLIProxyAPI has no saved service key
- **THEN** setup generates its independent key without asking a question and preserves it across back navigation
- **AND** cancellation before saving does not persist it, while saving records it in its owning persistent configuration for reuse

#### Scenario: Change the external model endpoint
- **WHEN** Configure receives an external model API base URL different from the saved URL while a provider API key is already saved
- **THEN** it skips the keep-existing-key confirmation and asks for a new masked API key
- **AND** an unchanged URL continues to offer the existing-key confirmation

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing `ams`. The menu SHALL offer exactly Configure stack, Apply configuration and Show connection details, each explicitly selected, with Configure initially selected. Menu Apply, standalone `ams apply` and immediate application SHALL use one fixed-runtime-directory workflow without configuration questions. The package SHALL include AMS-owned compiled code, build recipes and source metadata, and SHALL exclude TDAI template copies, source patches, installation credentials and runtime data. Native templates SHALL be acquired from the selected source independently of the caller's checkout.

#### Scenario: Install the packed package
- **WHEN** the operator configures an isolated installation from the installed npm archive
- **THEN** AMS obtains selected-source templates into flat defaults and saves operator overrides
- **AND** no developer checkout, packaged native template tree, running engine or image build is required to save configuration

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs `ams apply`
- **THEN** both apply the saved files without invoking Configure or requesting model choices
