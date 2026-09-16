## Purpose

Detect an existing complete AMS container group after Configure stack is selected and before configuration questions and direct the operator to its configuration without managing its lifecycle or credentials.

## ADDED Requirements

### Requirement: Best-effort complete stack discovery

AMS SHALL display the initial menu and wait for an explicit action. Only when Configure stack is selected, and before any configuration question, AMS SHALL inspect containers visible through the current user's available Docker and Podman endpoints using bounded read-only operations. A complete stack SHALL require all five implemented application services, `core`, `knowledge`, `panel`, `memory-proxy`, and `cli-proxy-api`, grouped by one exact AMS Compose project in one engine. Stopped application containers SHALL count. Support and initialization containers SHALL NOT be required. Detection SHALL NOT combine service evidence across projects or engines.

#### Scenario: Complete stack is running or stopped
- **WHEN** one visible AMS project contains all required application containers, regardless of running state
- **THEN** setup detects the existing stack after Configure stack is selected and before asking configuration questions

#### Scenario: Partial groups belong to different projects
- **WHEN** required application containers are spread across project groups or engines and no individual group is complete
- **THEN** detection does not combine them into an existing complete stack

#### Scenario: Runtime is unavailable or the stack is partial
- **WHEN** no complete stack can be detected because engines are unavailable or only partial container groups exist
- **THEN** ordinary setup remains available, including save-only setup without a running engine
- **AND** AMS does not claim that no installation exists elsewhere

### Requirement: Read-only existing installation exit

When a complete stack is detected, interactive setup SHALL exit successfully with guidance to edit the existing installation's `.env`. If the matched project's working-directory label provides a path, output SHALL show its `.env` location; absent metadata SHALL produce generic guidance without inventing a path. Detection SHALL NOT read configuration credentials, query Core administrator state, modify files, or create, start, stop, remove, or repair containers. The existing saved target SHALL remain a convenience reference rather than an ownership authority.

#### Scenario: Existing stack has a working-directory label
- **WHEN** a detected complete project supplies its working directory
- **THEN** setup prints the corresponding .env path and exits without asking for an administrator key or reading that file

#### Scenario: Existing stack has no working-directory label
- **WHEN** a complete project is detected without a configuration location
- **THEN** setup tells the operator to edit the existing installation's .env without asserting a guessed directory

### Requirement: Heuristic installation boundary

The setup guard SHALL describe its boundary as visible complete-container detection. It SHALL introduce no persistent registry, installation claim, lifecycle lock, cross-user enforcement, adoption, recovery state machine, or authoritative administrator-state probe. Missing or deleted containers, unavailable or unselected engine contexts, and concurrent invocations SHALL remain outside guaranteed duplicate prevention. Subsequent lifecycle management and recovery SHALL remain the operator's responsibility; the explicit saved-configuration apply command SHALL remain available.

#### Scenario: Existing containers were deleted
- **WHEN** no complete application container group is visible despite retained files or data
- **THEN** the guard permits the ordinary setup flow without registering, adopting, or repairing an installation
