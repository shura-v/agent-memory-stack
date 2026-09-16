## Context

See proposal.md for motivation. AMS derives a Compose project name from the installation directory and labels application containers by project and service. The wizard currently runs even when the full container group already exists. The current user can inspect the selected Docker/Podman engine endpoints without selecting a new Compose provider.

The required application set today is `core`, `knowledge`, `panel`, `memory-proxy`, and `cli-proxy-api`. MCP remains separately planned and is not required by this check until its implementation changes the application set.

## Goals / Non-Goals

**Goals:** Keep the initial menu visible and catch ordinary repeated setup after Configure stack is selected, before configuration questions, count stopped application containers, and provide an existing `.env` location when container metadata supplies it.

**Non-Goals:** Enforcing uniqueness across every engine, context, OS user, or simultaneous CLI process; maintaining installation claims or locks; adopting installations; repairing incomplete stacks; probing Core administrator state; adding administrator recovery or metadata classification; managing existing containers.

## Decisions

### 1. Inspect after Configure stack is selected

Display Configure stack and Apply configuration in the initial menu, with Configure stack selected by default. Wait for an explicit selection. Apply configuration dispatches directly to the same saved-target workflow as standalone `ams apply`, without a server argument or the Configure stack detection guard. Connect an agent remains a separately planned future menu action. For Configure stack, run a best-effort read-only check before directory, provider, credential, or other configuration questions. Opening the menu alone does not trigger detection. Inspect available Docker and Podman using their public container-listing interfaces with all container states included. Query only the endpoints visible through the current user's current engine configuration; do not enumerate other accounts, switch contexts, start daemons, or prompt for elevation.

Missing executables, unavailable engines, and incomplete inspection results do not establish that a complete stack exists. Continue the ordinary fresh/save-only flow when no complete group is detected. Bound inspection so an unavailable engine does not indefinitely prevent setup.

### 2. Group exact application labels

Correlate the exact Compose project and service labels used by AMS. Require one AMS project group containing all five implemented application service names in one engine. Running, stopped, and created containers count equally: presence is the only signal. Ignore support and initialization services such as `config` and `bootstrap` when deciding completeness.

Never combine service names from different project groups or different engines. A project name, one container, a saved target, an image, or a data directory alone is insufficient. This is a visible-container heuristic, not authenticated ownership or healthy-installation proof.

### 3. Exit with configuration guidance

When a complete group exists, print that the stack is already installed and the operator should edit its `.env`; finish the selected setup action successfully before any configuration questions or writes. Derive a display path from the matched project's Compose working-directory label when available. Treat it only as metadata: do not open `.env`, follow it for mutation, or infer that its current contents are valid. If the path label is missing, tell the operator to edit the existing installation's `.env` without inventing a directory.

Detection performs no administrator, service, or provider credential reads and no Core API requests. It stops, starts, removes, and repairs no containers. A stopped complete stack still short-circuits setup. A partially created stack can continue through the existing flow; its management remains the operator's responsibility.

### 4. Keep state and scope small

No host registration, UID binding, canonical-path identity, operation lock, adoption protocol, recovery state machine, or Core-state classifier is added. The existing target file remains a saved-path convenience for deferred application, not a claim or source of ownership. Keep `ams apply` available for initial deferred application and later `.env` changes. For the exact saved project in its configured engine, inspect whether every configured application service has a container; stopped containers count and helper jobs do not. This narrower per-target check also supports manually configured partial topologies.

When that configured application set exists, apply asks for no administrator key and runs the established bootstrap check instead of initialization or repair. It regenerates configuration and recreates the configured services while preserving the existing administrator credential. When the set is incomplete, retain the initial generated/manual key and handoff flow for local Core. Folder presence and applied inventory do not select an existing-key prompt. No authoritative Core-state classification or automatic recovery is introduced; missing, partial, or stale data remains the operator's responsibility. Existing-state check failures report failure instead of silently falling back to initial administrator creation.

### 5. Compare authorization for the selected account provider

Add `CLIPROXY_AUTH_PROVIDER` with values `codex` and `claude`; use `codex` when absent for compatibility. Setup offers **ChatGPT (Codex)** and **Claude** for local CLIProxyAPI. An existing complete installation changes this setting in `.env` and runs `ams apply`. This selection controls account setup only: it does not change model routing, restrict available provider APIs, or remove other providers' account files.

After startup, inspect the persisted local authorization files using a helper container with the authorization directory mounted read-only and networking disabled. Only an authorization record whose `type` matches the selected provider, is not disabled, and has a nonempty access or refresh credential satisfies the selected-provider check. Return only the result needed for the login decision, without printing or persisting tokens. A model list from any provider is not authorization evidence for the selected account provider. Finding a credential does not prove token freshness or successful inference.

Inspection/runtime/read failures are errors, not a missing-login result; they must not be silently converted into a login offer. If matching saved credentials exist, skip optional login for that provider. Otherwise offer its selected login flow. Preserve account files for all other providers.

Use `-codex-device-login -no-browser` for ChatGPT (Codex), showing the verification URL and device code. Use `-claude-login -no-browser` for Claude. For Claude, explain that after browser sign-in the user must copy the complete final localhost callback URL, including its query, even if the browser reports connection refused. The terminal asks for that URL after 15 seconds; do not press Enter with an empty value. No browser or inbound callback port is required on the hosting machine. Stop the local CLIProxyAPI service during login using the existing single-refresher lifecycle.

After the login process ends, rerun the selected-provider credential check before reporting success. Upstream can return exit code zero after a failed login, so exit status alone is insufficient. This confirms a matching persisted authorization record, not token validity or real provider inference.

### 6. Identify the two current user interfaces

Print **MemoryProxy (agent API)** and **Panel (web interface)** with their actual saved listener addresses/ports. These labels explain the audience without introducing endpoint routing or changing the separately approved Connect an agent text.

## Risks / Trade-offs

- Invisible engines or contexts can contain another installation → document that only current accessible endpoints are inspected.
- Deleted containers, partial stacks, or concurrent setup can evade detection → leave these cases to the operator; do not claim hard uniqueness enforcement.
- Matching labels can be copied manually → describe the result as detected container presence, not authenticated ownership or readiness.
- A working-directory label can be stale → print it as configuration guidance without reading files or modifying the discovered path.

## Migration Plan

Add the read-only check without writing a registration record or changing existing targets, labels, credentials, or data during discovery. Existing complete stacks short-circuit the selected Configure stack action, including stopped stacks; the initial menu remains visible. Fresh setups and partial/unavailable runtime cases retain the normal wizard. Explicit apply retains reconfiguration with existing-state checks for a complete configured application set. The earlier ownership and authoritative-administrator plan is superseded in full. Missing account-provider selection migrates to codex; saved Claude or other-provider accounts remain intact. The previous model-list-based login shortcut is replaced by the selected-provider authorization check.

Build required images and start configured containers for the sole current-stage acceptance task. Comprehensive functional validation remains deferred; container presence detection does not certify a functioning installation.
