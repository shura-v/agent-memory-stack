> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

### Requirement: Read-only existing installation exit

When a complete stack is detected, interactive setup SHALL exit successfully with guidance to inspect the existing installation's defaults/, edit its native overrides/, and edit orchestration `.env`. If non-secret project metadata or its persisted root reference identifies the native configuration location, output SHALL identify its defaults/ and overrides/ locations and the corresponding orchestration `.env`. A known working directory alone SHALL identify the runtime directory and its `.env`, without guessing a different native root; absent metadata SHALL produce generic guidance without inventing a path. Detection SHALL NOT read configuration credentials, query Core administrator state, modify files, or create, start, stop, remove, or repair containers. The recorded native root association SHALL identify configuration ownership independently of this best-effort container discovery.

#### Scenario: Existing stack has a working-directory label
- **WHEN** a detected complete project supplies its working directory
- **THEN** setup prints the corresponding runtime .env path and any native configuration root established by non-secret installation metadata, and exits without asking for an administrator key or reading secret-bearing configuration

#### Scenario: Existing stack has no working-directory label
- **WHEN** a complete project is detected without a configuration location
- **THEN** setup tells the operator to inspect defaults/, edit overrides/ and orchestration .env without asserting a guessed directory

### Requirement: Best-effort complete stack discovery

AMS SHALL display the initial menu and wait for an explicit action. Only when Configure stack is selected, and before any configuration question, AMS SHALL inspect containers visible through the current user's available Docker and Podman endpoints using bounded read-only operations. A complete stack SHALL require all six application services, `core`, `knowledge`, `panel`, `memory-proxy`, `cli-proxy-api`, and `mcp`, grouped by one exact AMS Compose project in one engine. Stopped application containers SHALL count. Support and initialization containers SHALL NOT be required. Detection SHALL NOT combine service evidence across projects or engines.

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
