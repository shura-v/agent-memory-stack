## MODIFIED Requirements

### Requirement: Explainable local service selection

Choosing Configure stack in `ams` SHALL enter stack setup without a service-selection question. A fresh installation SHALL configure the complete implemented local stack, including MCP and its required support services when this change is implemented. Existing explicit service selection and dependency modes SHALL remain authoritative, including installations without MCP. Advanced service selection SHALL remain editable through `.env`; setup SHALL display the resulting topology without asking the operator to choose services. Missing or invalid advanced settings SHALL produce actionable configuration guidance.

#### Scenario: Accept a complete local stack
- **WHEN** the operator configures a fresh installation after MCP is implemented
- **THEN** setup derives Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI, MCP, and required support services for one Compose project without displaying service checkboxes

#### Scenario: No local services selected
- **WHEN** an explicit saved selection is empty
- **THEN** setup reports an invalid AMS_SERVICES value to correct in .env without opening a checkbox prompt or changing running services

#### Scenario: Proceed directly to installation
- **WHEN** the operator chooses Configure stack
- **THEN** setup asks installation and provider questions without service-selection or local-action prompts
- **AND** local Core retains its administrator initialization flow and saved configuration remains applicable through the existing command

#### Scenario: Enable MCP with split dependencies
- **WHEN** an existing or manually edited configuration enables MCP with remote dependencies
- **THEN** setup reads its Core and protected Knowledge dependencies from .env, resolves its host port automatically during apply, and does not ask for topology, addresses, or ports
- **AND** missing required configuration prevents application with guidance to edit .env

#### Scenario: Preserve an existing installation
- **WHEN** setup reads an existing explicit service selection without MCP
- **THEN** it preserves that selection, identities, credentials, and preferred ports instead of enabling extra services
- **AND** the operator can add MCP through .env and apply the saved configuration
