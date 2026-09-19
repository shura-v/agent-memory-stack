> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## MODIFIED Requirements

### Requirement: Fixed complete local service composition

Configure stack SHALL always configure Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP together with their three required support containers. Setup SHALL display this fixed composition without service-selection questions. Service selection, dependency placement and disabled-service modes SHALL NOT be configurable through orchestration settings. Removed service-selection and remote-placement fields SHALL NOT control deployment composition or trigger a conversion.

#### Scenario: Configure the complete local stack
- **WHEN** the operator configures a fresh installation or reapplies saved settings
- **THEN** all six application services and their support containers belong to one local Compose project
- **AND** setup offers both internal LLM source choices independently of service composition

#### Scenario: Reject removed deployment controls
- **WHEN** orchestration settings include AMS_SERVICES, AMS_DEPLOYMENT_VERSION, placement-mode or REMOTE_* fields
- **THEN** the installation retains its fixed complete local composition
- **AND** no migration, subset deployment or remote replacement is inferred
