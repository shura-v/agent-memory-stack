## MODIFIED Requirements

### Requirement: Explicit interactive configuration and cancellation

Setup SHALL request the interactive settings consumed by the selected deployment, offer defaults for operational choices, and ask for real provider credentials and endpoints when an external internal-model source is selected. Local CLIProxyAPI mode SHALL derive its API access and defer missing internal model choices until account authorization during apply. Missing locally owned Core and CLIProxyAPI service keys SHALL be generated automatically; existing keys SHALL be reused without keep, generation, or manual-entry questions. These keys SHALL be saved only at the existing configuration-save boundary and SHALL remain stable across question navigation. Explicit .env keys SHALL remain authoritative. Advanced token limits and LLM timeouts SHALL remain editable in `.env` using the upstream deployment defaults without wizard questions. Secret input SHALL be masked; configuration review and routine diagnostics SHALL redact secret values. The intentional initial admin-key handoff is the documented exception. Cancellation before saving SHALL not deploy services or replace an existing configuration. Cancellation after saving SHALL retain the saved desired settings without replaying installation effects.

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

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing the executable `ams`. Running `ams` SHALL offer Configure stack and Apply configuration, with Configure stack selected initially. Each action SHALL require explicit selection. Setup and its existing-stack detection SHALL begin only after the operator selects Configure stack. Apply configuration SHALL use the same fixed-directory application workflow as standalone `ams apply`, without a server or path argument and without entering the setup wizard or its detection guard. Saved settings SHALL also remain applicable through the immediate-apply prompt. Connect an agent SHALL remain a separate planned action until its implementation is delivered. The package SHALL contain the compiled CLI and the templates/runtime assets needed by setup and application; execution SHALL not depend on the source checkout or developer sibling repositories. Release artifacts SHALL exclude real credentials and runtime data.

#### Scenario: Install the packed package
- **WHEN** the operator installs the locally produced npm archive into an isolated directory
- **THEN** the installed ams offers Configure stack and Apply configuration and waits for selection with Configure stack selected initially
- **AND** required templates resolve relative to the installed package while configuration output is written to `homedir()/.agent-memory-stack`

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs ams apply
- **THEN** both paths use the same fixed configuration directory and application workflow without a server argument or the Configure stack detection guard, reusing saved settings except for completing missing deferred local model choices after authorization
