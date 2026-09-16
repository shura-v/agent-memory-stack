## Why

The setup wizard asks operators to design a deployment topology and choose network settings before they can start the stack. A standard installation should configure the local stack and resolve occupied Docker/Podman ports automatically.

## What Changes

- Remove the service checkbox question, stack address and port inputs, remote-dependency choices, and service-interface confirmations such as `Allow service connections to Core from another machine?`.
- Use the complete implemented local stack for fresh installations; preserve existing explicit topology and network settings. Keep advanced topology, external domains, and service-interface switches editable in `.env`. The default host listeners are Panel, MemoryProxy, and MCP once implemented. Core, CLIProxyAPI, direct Knowledge HTTP tools, and Knowledge service interfaces remain unpublished by default.
- During apply, try saved ports or the established defaults in the selected Docker/Podman runtime, choose free alternatives on conflict, persist the resulting host ports, and update generated local origins. Keep all published listeners on `127.0.0.1`.
- Automatically generate missing local Core and CLIProxyAPI service keys and reuse saved keys without keep/generate/manual questions. Preserve explicit .env overrides and keep administrator and external-provider credentials separate. Keep the explicit Configure stack menu, real LLM provider endpoint/key and model questions, administrator flow, and save-first/apply-later behavior. Show resolved ports without asking users to select them.
- Apply the same automatic-port behavior to the planned MCP listener when implemented; its earlier proposed port prompt and fresh-install opt-in checkbox are superseded by this change. Preserve the approved Connect an agent wording and supply its actual saved ports.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment-composition`: Automatic fresh-install topology, configuration-only advanced networking, question navigation, and runtime-aware port allocation.
- `server-deployment`: Panel/MemoryProxy/MCP-only default publication, internal Knowledge access through MCP, derived local origins, and a smaller interactive flow.
- `stack-delivery`: Network-free save-only setup and automatic network settings instead of URL questions.

## Impact

Wizard orchestration and questions, environment parsing, deployment resolution, engine/process integration, Compose generation/application, saved configuration snapshots, connection information, and README. No dependency or runtime upgrade is required by the plan. Existing public authentication and loopback boundaries remain. Acceptance remains required images built and selected containers started; comprehensive functional checks stay deferred.
