## Why

A user can accidentally start setup again while the complete stack already exists. Detecting its application containers after the operator chooses Configure stack and before configuration questions provides a simple exit and points the operator to the existing `.env`.

## What Changes

- Offer Configure stack and Apply configuration in the initial menu, with Configure stack selected by default; after that action is selected and before any configuration question, inspect containers visible through the current user's available Docker and Podman engines, including stopped containers.
- Recognize a complete stack only when all five implemented application services belong to the same exact AMS Compose project in the same engine. Initialization/support containers do not establish completeness.
- Exit setup with an existing-installation message and `.env` guidance. Print the project working-directory label's `.env` path when available, without reading configuration or credentials.
- Provide the standalone `ams apply` command and matching Apply configuration menu action: an exact saved project with every configured application container uses the existing-state bootstrap check without an administrator prompt or initialization/repair; otherwise retain the initial administrator flow.
- Continue ordinary setup when no complete visible stack is found, including unavailable engines and partial installations. Keep this a documented heuristic; remaining installation and lifecycle management is the operator's responsibility.
- Compare saved CLIProxyAPI authorization against the selected ChatGPT (Codex) or Claude account provider before offering login; preserve other account files and existing model routing. Label printed endpoints as MemoryProxy (agent API) and Panel (web interface).

## Capabilities

### New Capabilities

- `host-installation`: Best-effort discovery of a complete existing AMS container group after Configure stack is selected.

### Modified Capabilities

- `stack-delivery`: Configure stack / Apply configuration menu and standalone ams apply without a server argument.

- `deployment-composition`: Keep the initial menu and short-circuit repeated setup after Configure stack is selected, before configuration questions.
- `server-deployment`: Skip server configuration and administrator questions when a complete stack is detected, and make account setup compare authorization for the selected CLIProxyAPI provider.

## Impact

CLI setup dispatch, read-only engine container inspection, and English setup guidance. Existing target storage remains a convenience for deferred application, not installation ownership. Detection introduces no persistent registry, locks, Core metadata queries, credential reads, container changes, or data migrations. Explicit apply retains its normal lifecycle effects with container-presence-based selection of initial bootstrap versus existing-state check. Provider setup adds a read-only authorization-file helper and selected login flow; existing completed build/start evidence remains historical evidence for that delivered state, not proof of the subsequent provider changes.
