## MODIFIED Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing the executable `ams`. Running `ams` SHALL offer Configure stack and Apply configuration, with Configure stack selected initially. Each action SHALL require explicit selection. Setup and its existing-stack detection SHALL begin only after the operator selects Configure stack. Apply configuration SHALL use the same saved-target application workflow as standalone `ams apply`, without a server or path argument and without entering the setup wizard or its detection guard. Saved settings SHALL also remain applicable through the immediate-apply prompt. Connect an agent SHALL remain a separate planned action until its implementation is delivered. The package SHALL contain the compiled CLI and the templates/runtime assets needed by setup and application; execution SHALL not depend on the source checkout or developer sibling repositories. Release artifacts SHALL exclude real credentials and runtime data.

#### Scenario: Install the packed package
- **WHEN** the operator installs the locally produced npm archive into an isolated directory
- **THEN** the installed ams offers Configure stack and Apply configuration and waits for selection with Configure stack selected initially
- **AND** required templates resolve relative to the installed package while user output is written to the saved or selected installation directory

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs ams apply
- **THEN** both paths use the same remembered target and application workflow without a server argument, configuration questions, or the Configure stack detection guard
