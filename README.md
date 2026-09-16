# Agent Memory Stack

Run `ams` to choose **Configure stack** (selected by default) or **Apply configuration**. Choose Configure stack to create configuration. After that selection, AMS checks for an existing stack. If all five application containers already exist in one visible AMS project, including stopped containers, setup directs you to its `.env` and exits before configuration questions. A machine can be your laptop or a VPS. Each installation has one generated Compose project.

## Read first: MemoryProxy and MCP serve different purposes

**MemoryProxy becomes the model API base for your agent and adds memory context. MCP separately exposes Knowledge tools to that agent.**

| | MemoryProxy | Knowledge MCP |
| --- | --- | --- |
| Connection | Use the agent's Base URL and API key shown in Panel | Register a separate Streamable HTTP MCP server |
| Purpose | Add memory context to requests sent to the agent's model | Search Wiki and code resources through discoverable tools |
| Execution | The agent's model requests pass through MemoryProxy | MCP forwards tool calls to the protected Knowledge gateway |
| Available today | Configured by AMS; Panel shows agent endpoints and API keys | Planned through server-side Supergateway; not implemented yet |

Knowledge processing and the Panel Wiki interface remain available today. The protected Knowledge tool gateway stays inside Compose by default. MemoryProxy emits direct Knowledge HTTP tool instructions only when `KNOWLEDGE_TOOLS_PUBLIC_ENABLED=true` is explicitly set in `.env`. This advanced path requires an origin reachable from the agent and a tool capable of making HTTP requests, such as a shell running `curl`. A model connection alone does not register MCP tools or prove Knowledge tool access.

The upstream [Knowledge MCP server](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryKnowledge/src/mcp/server.ts) uses `stdio`. Its direct Wiki/CodeGraph routes differ from AMS's protected `/v3/tools/list` and `/v3/tools/call` contract. The planned server integration adapts that contract and preserves each caller's memory-user authorization. There is currently no supported ready-to-run MCP registration command for AMS.

## CLI overview

The CLI uses Node.js **24+**, TypeScript, `@clack/prompts` **1.8.1**, and `yaml` **2.9.1**. The wizard reads the deployment from `.env`, using the complete local stack for a fresh installation, and uses that plan for questions, service configuration, YAML generation, image checks, and startup.

From this checkout, run `npm run dev` to compile TypeScript and open the setup wizard.

Press **Escape** to return to the previous question, or **Ctrl+C** to cancel. Confirmed answers are restored when revisiting a question; secret fields let you press Enter to keep their previous value without displaying it. Changing an earlier answer clears subsequent answers so dependent settings are recalculated. Escape on the first menu exits. Back navigation ends when configuration is saved; cancelling afterward retains those settings without replaying writes or installation.

## 1. Start setup

Install Node.js 24+ and npm to configure the stack. Server application also requires Docker or Podman with Compose. Builds use the pinned sources in `upstream.lock.json`; a separate TencentDB checkout is unnecessary.

```sh
npm ci
npm run dev
```

Choose **Configure stack**. If no complete stack is detected, complete the setup questions. The wizard saves configuration, then asks **Apply configuration now?**, with **Yes** selected. **No** exits successfully and keeps the saved configuration. **Yes** applies it immediately. Apply later by choosing **Apply configuration** in the menu or running the standalone command, without repeating setup questions:

```sh
ams apply
```

From this checkout, use `npm run dev -- apply`. The CLI remembers the most recently saved installation directory for the current OS user in `$XDG_CONFIG_HOME/agent-memory-stack/targets.json`, defaulting to `~/.config/agent-memory-stack/targets.json`. The file contains only the version and absolute installation path. Installed `ams` commands work from any directory; no path argument or Compose project hash is needed. The remembered path is a convenience for deferred application, not an installation ownership record.

Server apply verifies the saved Compose provider before building images or proceeding with application. It then checks local image identities and build-input fingerprints, builds missing or outdated images, resolves published ports in the selected engine, saves the chosen ports, regenerates configuration, and recreates containers. The first build downloads pinned sources, base images, and dependencies. The wizard manages `.ams/images.json` automatically; you do not need to supply it. Changing `.env` does not require rebuilding unchanged images. Updating packaged code or image build inputs triggers a cached rebuild before services stop; matching images loaded from a bundle remain reusable offline.

`ams apply` remains available after installation. If every configured application container exists in the saved project, including stopped containers, apply uses the established existing-state bootstrap check and asks for no administrator key. It preserves the existing administrator credential and performs no initialization or repair. An incomplete application-container set keeps the initial generated/manual key flow for local Core. This heuristic does not diagnose missing or inconsistent Core data; failed checks and partial installations remain the operator's responsibility.

Saved desired configuration remains available if application fails. Image preparation or preflight failures leave runtime configuration and running application containers unchanged. Downloaded sources and build cache can remain for a retry. Saving configuration alone needs no container engine or administrator key.

### Optional: prepare images on another machine

For offline delivery or building on a different host, use the separate build/export/load workflow:

```sh
npm run build
npm run build:images -- --runtime podman --platform linux/arm64 --project-dir ./delivery
npm run build:images -- --runtime podman --project-dir ./delivery --export ./images
npm pack
```

For an x86 VPS, build `linux/amd64` images with a compatible builder. Setup checks the actual container engine architecture before initialization. The build produces five application images and one runtime image for support containers. A CLIProxyAPI-only installation needs its application image and the runtime image; deployment preflight accepts a larger manifest without inspecting unused local images.

Distribute the npm archive and image bundle separately. Export creates `images.tar`, `images.json`, and `bundle.json`; load verifies checksums, archive contents, platform, and image identities. Build/export defaults still produce the complete distribution. Deployment-specific image requirements do not relax bundle integrity checks.

On the destination machine:

```sh
npm install --global ./agent-memory-stack-0.1.0.tgz
node "$(npm root -g)/agent-memory-stack/dist/build/cli.js" --runtime docker --project-dir ./server --load ./images
ams
```

Use `--runtime podman` for Podman image operations. In setup, select Docker Compose, configured `podman compose`, `podman-compose`, or `uvx podman-compose`. Shell aliases such as `docker=podman` are not used. Load images into the same installation directory you select in the wizard; verified images are reused. Container startup itself does not compile applications. These commands do not publish to npm or a registry.

`Podman compose (configured provider)` requires an external Compose provider already configured for `podman compose`. If only Podman and uv are installed, select **Podman + uvx podman-compose**. An unavailable provider now fails before image builds, with instructions for the selected provider.

## 2. Configure the local stack

After you choose **Configure stack**, and before any configuration question, setup inspects the current user's available Docker and Podman endpoints read-only. The initial menu is always shown; opening it alone does not trigger detection. All five application service labels must belong to one exact AMS Compose project in one engine. Support/init containers do not count; stopped application containers do. When the group is complete, output points to its `.env` using the project working-directory label if available and exits successfully. No credentials or configuration files are read by this check.

This detects ordinary repeated setup; it does not enforce uniqueness across inaccessible contexts, deleted/partial stacks, concurrent invocations, or other accounts. If no complete group is visible, setup continues, including save-only operation without a running engine. It creates no registry or lock and repairs nothing automatically.

Run `ams` and choose **Configure stack**. The first question suggests `./ams` in the current directory; a remembered installation path takes precedence. Fresh installations include all five implemented application services:

| Service | Purpose |
| --- | --- |
| Core | Memory storage, users, and permissions |
| Knowledge | Wiki and document processing |
| Panel | Web interface for managing the stack |
| MemoryProxy | Adds memory context to agent requests |
| CLIProxyAPI | Provides API access to supported AI providers |

Support containers are added automatically. The wizard displays the configured services and asks no service-selection, dependency-placement, stack-address, port, or interface-enablement questions. An existing explicit `AMS_SERVICES` selection and its advanced network settings remain unchanged. MCP will join the fresh defaults when its separate implementation is available; it is not installed today.

The remaining questions cover the installation and data directories, Compose provider, real LLM API base/key, separate Core and Knowledge models, CLIProxyAPI account provider, memory prompt mode, and log level. The provider URL has a neutral placeholder and no preset real endpoint. The wizard automatically reuses saved Core and CLIProxyAPI service keys and generates missing local keys without questions. Explicit keys in `.env` remain authoritative; remote credentials are never generated. The real provider API key remains an interactive input. Administrator handling happens during application. Advanced split deployments are configured through `.env`; missing required fields produce named configuration errors instead of additional topology questions.

**Memory prompt mode** controls what Core extracts and summarizes from conversations. Choose **code** (the default) for project decisions, technical constraints, and reusable team practices; choose **chat** for personal preferences, events, and lasting instructions. This changes Core's memory prompts, not the model used to answer agent requests.

Output-token limits and LLM timeouts are configured directly in `.env`; the wizard does not ask for them and preserves existing values:

| Setting | Stack default |
|---|---|
| `MEMORY_LLM_MAX_TOKENS` | `32000` |
| `KNOWLEDGE_LLM_MAX_TOKENS` | `32768` |
| `MEMORY_LLM_TIMEOUT_MS` | `300000` (5 minutes) |
| `KNOWLEDGE_LLM_TIMEOUT_MS` | `1200000` (20 minutes) |

Core defaults follow the pinned TDAI deployment script, `deploy/global-images/start-memory-core.sh`; Knowledge defaults follow its configuration loader. Core's separate standalone example and bare loader use `4096` tokens and `120000` ms, so the launch path matters. Explicit values already saved in `.env` take precedence. See [the defaults audit](DEFAULTS-AUDIT.md) for remaining differences from upstream deployment behavior.

### Complete local installation

For Core and Knowledge models, the wizard tries the provider's `GET /models` endpoint using the entered API base and key. A returned list becomes a select menu with a manual-entry option; an unavailable, invalid, or empty list falls back to text input after at most 5 seconds. Saved model names remain available, including names absent from the list. Discovery runs once per setup on the machine running the CLI and does not send an inference request.

1. Choose **Configure stack**, confirm the **Compose configuration directory** (for `compose.yaml` and `.env`) and Compose provider, and enter your real model-provider settings. Services run in containers.
2. Review and save the configuration. **Apply configuration now? → No** keeps it for later; **Yes** applies it immediately.
3. Generate or supply the administrator key and save it when displayed. Application prepares images, resolves ports, and starts the configured services.
4. If the selected CLIProxyAPI account provider needs authorization, complete its optional login flow. Open Panel at the printed address and copy your agent's endpoint and key there.

### Automatic ports

Panel prefers port `8123`; MemoryProxy prefers `8096`. Apply first tries the saved preferred ports through the selected Docker/Podman engine. It reuses listeners owned by the same installation and selects free alternatives for conflicts with unrelated listeners. The resulting ports are saved in `.env` and printed after application. Every published listener remains bound to `127.0.0.1`.

Saving alone does not probe ports or require an engine. `.ams/network.json` records generated local origins so later port changes update generated localhost addresses while preserving manually configured Caddy domains. Container-to-container addresses and provider API prefixes remain unchanged. A failed application retains retryable desired settings without claiming that services started.

Knowledge, Core, and CLIProxyAPI have no default host entry points. Knowledge's protected tool gateway remains available inside Compose. The planned MCP listener will use the same automatic allocation and persistence when implemented.

### VPS and Caddy

Configure the same full stack on the VPS. After application, use the printed **actual ports** as Caddy upstreams. The example below uses the preferred ports; replace them if apply allocated different ones:

```caddyfile
models.my-domain.tld {
    reverse_proxy 127.0.0.1:8096 {
        flush_interval -1
    }
}
panel.my-other-domain.tld {
    reverse_proxy 127.0.0.1:8123
}
```

Set `MEMORY_PROXY_PUBLIC_URL` and `PANEL_PUBLIC_URL` in the installation `.env` to your respective origins, then run `ams apply`. Saved external origins survive port reallocation. Preserve request paths and streaming behavior. Use the endpoint paths shown in Panel; AMS does not add another custom routing scheme. Caddy, DNS, TLS, and firewall configuration belong to the operator. Once MCP is implemented, forward its printed port separately with `/mcp` preserved.

### CLIProxyAPI account login

CLIProxyAPI supports several AI providers and API formats. Setup asks which account to configure: **ChatGPT (Codex)** or **Claude**. The choice is stored as `CLIPROXY_AUTH_PROVIDER=codex` or `claude`; an absent value defaults to `codex` for compatibility. On an existing installation, change it in `.env` and run `ams apply`.

Apply checks the selected provider's saved authorization before offering login. A matching, non-disabled record with an access or refresh credential skips the question. Credentials from another provider and a nonempty model list do not count. The check reads the authorization directory through a read-only helper with networking disabled; read/runtime failures are reported instead of treated as missing login. Saved credentials do not prove token freshness or inference access.

| Selected account | Browser and terminal steps |
| --- | --- |
| ChatGPT (Codex) | `-codex-device-login -no-browser`: open the displayed verification URL on your computer and enter the device code. |
| Claude | `-claude-login -no-browser`: sign in through the displayed URL, then copy the **complete final localhost callback URL**, including its query. The browser may show connection refused. The terminal asks for this URL after **15 seconds**; paste it there and submit. **Do not press Enter on an empty prompt.** |

The VPS needs no browser or inbound callback port. OAuth files stay in `data/cli-proxy-api/auth`. The local service stops for login so only one process refreshes its tokens. After login, AMS checks for the selected provider's saved credentials again: a zero process exit alone does not mean authorization succeeded. Selecting an account provider affects account setup only; it does not change model routing or delete other providers' authorization.

MemoryProxy reaches local CLIProxyAPI over Compose. Advanced direct consumers can enable `CLIPROXY_SERVICE_ENABLED=true` in `.env`; its preferred loopback port is `8317`. Such consumers use the CLIProxyAPI service key and the appropriate provider API route. Direct CLIProxyAPI access does not add memory or Knowledge tools.

### Advanced topology through .env

`AMS_SERVICES` defines the application services on this machine. The `CORE_MODE`, `MODEL_MODE`, `KNOWLEDGE_MODE`, `PANEL_MODE`, and `PROXY_MODE` values must agree with that selection. Local dependencies use Compose addresses; required absent services need explicit remote endpoints and existing credentials in `.env`. Optional absent integrations default to disabled. Reconfigure these fields directly, then run `ams apply`; the wizard preserves them.

To expose a service to another installation, explicitly set its `*_SERVICE_ENABLED=true` flag and provide your own forwarding. To expose direct Knowledge HTTP tools, separately set `KNOWLEDGE_TOOLS_PUBLIC_ENABLED=true` and an agent-reachable `KNOWLEDGE_PUBLIC_URL`. Merely having a legacy Knowledge port or origin does not enable publication. Use the actual allocated ports printed by apply.

Knowledge on a different machine still needs a Panel callback owner: completing a Wiki operation updates its entity in Core. Panel needs the authenticated Knowledge service interface, and Knowledge needs a reachable Panel callback base. Both must use the same Core credential and persistent Core/Knowledge pair. Fully configured but unavailable peers can use the existing explicit staged-start flow; failed authentication and incompatible pairing cannot be bypassed.

### Addresses and authenticated interfaces

Configuration distinguishes container service endpoints from addresses advertised to agents and browsers. A remote service endpoint must be reachable **from the consuming containers**; `localhost` inside a container refers to that container. HTTP and HTTPS are supported, with ordinary HTTPS certificate verification enabled.

| Address setting | Meaning |
| --- | --- |
| `REMOTE_CORE_URL` + `REMOTE_CORE_API_KEY` | Authenticated Core service base and its existing credential |
| `REMOTE_MODEL_BASE_URL` + `REMOTE_MODEL_API_KEY` | Model API base including its prefix, such as `/v1`, and its existing credential |
| `REMOTE_KNOWLEDGE_URL` | Authenticated Knowledge service adapter used by a remote Panel |
| `REMOTE_PANEL_URL` | Panel service base used by Knowledge completion/progress callbacks |
| `*_PUBLIC_URL` | Agent/browser HTTP(S) origin, without credentials, API path, query, or fragment |

Service bases preserve configured path prefixes. Copy agent-specific MemoryProxy endpoint paths from Panel. Explicit direct Knowledge HTTP tools use the configured Knowledge origin with one `/v3` prefix. A reverse proxy publishing a service base under a prefix must route that prefix to the corresponding backend root.

| Published interface | Default loopback port | Audience and authorization |
| --- | --- | --- |
| MemoryProxy (agent API) | `8096` | Agent requests with memory-user and session authorization |
| Knowledge HTTP tools, explicitly enabled | `8422` | Memory-user key, active membership, and asset access checks |
| Panel (web interface) | `8123` | Browser/user interface; authenticated service callbacks share this listener |
| Core service, explicitly enabled | `8420` | Trusted service consumers using the Core service key |
| CLIProxyAPI service, explicitly enabled | `8317` | Model API consumers using its service key; management routes remain disabled |
| Knowledge service, explicitly enabled | `8423` | Panel's allowlisted Wiki/code-graph operations using the Core service credential |

Every binding is `127.0.0.1`. These are preferred ports, not guaranteed final assignments. The current default publishes only Panel and MemoryProxy; MCP will be the third default entry point when implemented. The underlying Knowledge process is never published directly. Its service adapter supports the pinned Panel Wiki/code-graph routes and uploads; its public tool adapter exposes only protected tool list/call routes. A service credential and a memory-user key serve different audiences.

## 3. Credentials, settings, and agent connections

Persistent settings live in `<installation>/.env`. `AMS_DEPLOYMENT_VERSION=1` and `AMS_SERVICES` record the canonical selection. `CORE_MODE`, `MODEL_MODE`, `KNOWLEDGE_MODE`, `PANEL_MODE`, and `PROXY_MODE` record resolved local/remote/disabled connections. `*_SERVICE_ENABLED` controls optional service listeners; `*_SERVICE_PORT` sets preferred ports. `KNOWLEDGE_TOOLS_PUBLIC_ENABLED=false` keeps direct Knowledge HTTP tools private by default. An older installation without selection metadata is interpreted as the complete local stack.

Local service keys are generated automatically when missing and reused on later setup runs without prompts. Explicit valid `.env` values are honored; invalid configured keys produce a field-specific error. Locally owned `CORE_API_KEY` and `CLIPROXY_API_KEY` are independent from `REMOTE_CORE_API_KEY` and `REMOTE_MODEL_API_KEY`. Inactive recognized settings are retained so switching a service back on reuses its credentials. Unknown or malformed settings fail explicitly. Validation applies to consumed settings; apply resolves collisions between published port preferences.

Generated keys use `sk-ams-admin-…`, `sk-ams-core-…`, and `sk-ams-cliproxy-…`, with 32 independently generated random bytes encoded as hex. The administrator key is requested only during application, displayed before initialization, and passed to local Core bootstrap through stdin. It is not added to `.env`, a separate admin-key file, command arguments, or container environment variables. Core persists its credential database. Save the displayed key yourself; applying a complete existing application-container set uses the existing-state check without requesting that key. Setup never initializes or repairs a remote Core.

Double-quoted `.env` values use JSON escaping: `\\` represents a backslash, `\"` represents a quote, and `$` stays literal. Derived `.ams/compose.env` contains only image IDs, paths, and ports. Generated YAML/configuration is not another settings authority.

Edit the saved server `.env` and apply it with:

```sh
ams apply
```

Apply reloads current settings and the saved Compose provider, regenerates Compose and service configuration, and recreates the selected containers. A plain container `restart` does not apply changed configuration. Edit service selection and advanced networking through the recognized `.env` fields directly. Generated `compose.yaml` and `.ams/compose.env` are refreshed by application. Cancellation before saving leaves previous settings intact; declining application after saving keeps the new desired settings without touching running containers.

### Agent connection information

Copy your agent's MemoryProxy Base URL and API key from **Panel → API Keys → Client Access Endpoint**. On the service host, use localhost. On another computer, use your Caddy domain and preserve the endpoint path shown in Panel.

The administrator key and memory-user key are not stored in the installation configuration. Use your saved administrator key to sign into Panel, and obtain the intended user key and authorized team/agent IDs there. Knowledge and MemoryProxy use the same memory-user identity; Core and CLIProxyAPI service keys are not agent credentials.

The CLI menu contains **Configure stack** and **Apply configuration**, with Configure stack selected initially. Existing-stack detection runs only after Configure stack is selected; Apply configuration uses the same saved-target workflow as `ams apply`. The future information-only **Connect an agent** action is planned in [print-agent-connection-info](openspec/changes/print-agent-connection-info/proposal.md). The server-side MCP transport is planned separately in [add-server-mcp-gateway](openspec/changes/add-server-mcp-gateway/proposal.md). Neither feature is currently implemented.

With explicit direct Knowledge HTTP exposure enabled, MemoryProxy injects resource-specific HTTP instructions using `KNOWLEDGE_PUBLIC_URL`. The agent's execution environment must supply `AMS_USER_KEY` for those requests and be able to reach that origin. Default private Knowledge emits no direct HTTP tool instructions; ordinary memory and skill instructions remain active.

## 4. Reconfiguration and recovery

State belongs to the machine running each service: `data/core` stores memory and credentials, `data/knowledge` stores Wiki and database state, `data/panel` stores templates, `data/proxy` stores sessions, and `data/cli-proxy-api` stores OAuth files. Selected services run as UID 10001; support containers prepare their directories. Deselection preserves data and reusable keys.

Saving keeps desired `.env` and provider settings separate from previous applied input bytes in restricted `.ams/before-save.json` and `.ams/last-applied-inputs.json` records. During application, a restricted runtime helper snapshots Compose, image/runtime settings, network allocation metadata, applied inventory, and generated files into **`.ams/previous-settings/`**; its input files are restored from the previous applied bytes. Thus saving several times or editing `.env` directly does not overwrite the rollback baseline. These records contain secrets and use restricted permissions. **`.ams/apply-pending`** preserves the same snapshot across failed retries; it is removed after a successful apply, including an explicitly accepted staged start. The snapshot contains configuration, not application databases or OAuth data.

`.ams/applied.json` records managed containers; `.ams/readiness.json` records integration results. Only deselected containers belonging to this installation are removed. The project name is stable for its installation directory. Remote services and unrelated projects are not changed.

### Move a service and roll back

1. Back up the old installation's complete data while all its writers are stopped. Keep the matching package and image manifest. Editing AMS_SERVICES does not migrate a database or OAuth identity.
2. Prepare the destination independently and restore compatible data if continuity is required. Keep the source OAuth refresher stopped before starting the same token files elsewhere.
3. On the original machine, remove the service from AMS_SERVICES and configure its remote replacement in .env, and review local removals before applying. Retain the original data and local keys for reversal.
4. To reverse the switch, stop the remote owner if it shares restored state, restore the local service in AMS_SERVICES and its corresponding modes, and reuse its preserved data and key. Compare any divergent data before resuming; there is no automatic synchronization.
5. For configuration rollback, preserve `.ams/previous-settings` outside the installation first, stop its writers, restore the matching saved settings/package/images and compatible data as needed, then use the saved target's explicit apply command. Verify identity, a reference conversation, and Wiki content. An incomplete apply does not promise atomic database rollback.

A cold recovery backup must include **the entire `DATA_DIR`**, `.env`, `compose.yaml`, and the `.ams` directory. Use a tool with permission to read UID 10001 files; restrict the archive to `0600`. Restore into a separate empty directory first. Update `DATA_DIR` in `.env` if the location changes. Restore and inspect the target/container state explicitly; the setup guard and apply heuristic do not provide automatic recovery for restored or incomplete data. Retain only one active OAuth refresher. Back up Caddy/TLS through your separate process.

Use `docker ps -a` or `podman ps -a` to inspect containers. Read logs with `docker logs <container-name>` or `podman logs <container-name>`. Diagnose the failing stage separately: configuration/image checks, local process readiness, service authentication/pairing, provider authorization, or agent/semantic behavior. Process health does not prove usable Wiki integration or model access.

## 5. Validation status

The acceptance criterion for the current delivery stage is **required images built and selected containers started**. Comprehensive agent, MCP, provider, memory/Wiki, authorization, and recovery validation follows Supergateway and the remaining integrations. [VALIDATION.md](VALIDATION.md) preserves the existing test evidence and describes those deferred scenarios separately.
