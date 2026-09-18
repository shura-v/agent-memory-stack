# Stack setup and operations

For an overview and a quick start, see the [README](../README.md). For source builds and contributions, see [Development](development.md).

## 🚀 1. Start setup

Install Node.js 24+ and npm to configure the stack. Server application also requires Docker or Podman with Compose. Fresh installations use the pinned sources in the packaged `upstream.lock.json`; a separate TencentDB checkout is unnecessary.

To update TDAI on this server, run `ams update tdai`. It downloads the latest `feat/server_team` revision and rebuilds/applies the saved installation. The selected revision lives in its `.ams/tdai-source.json`; the npm package is unchanged. See [Updating TDAI](updating-tdai.md).

```sh
npm install -g agent-memory-stack
ams
```

The menu offers **Configure stack**, **Apply configuration**, and **Show connection details**. Start with **Configure stack**. If a complete installation is already visible, AMS points you to its `.env`; use **Apply configuration** for later changes. Otherwise, follow the setup questions. The wizard saves configuration, then asks **Apply configuration now?**, with **Yes** selected. **No** exits successfully and keeps the saved configuration. **Yes** applies it immediately. Apply later by choosing **Apply configuration** in the menu or running the standalone command, without repeating setup questions:

```sh
ams apply
```

**Wizard controls:** Escape returns to the previous question; Ctrl+C cancels. Confirmed answers are restored when revisiting a question; changing an earlier answer clears dependent answers. Press Enter on a saved secret field to keep its value. Escape on the first menu exits. Back navigation ends when configuration is saved; declining immediate application keeps your saved settings for later.

From this checkout, use `npm run dev -- apply`. The CLI remembers the most recently saved installation directory for the current OS user in `$XDG_CONFIG_HOME/agent-memory-stack/targets.json`, defaulting to `~/.config/agent-memory-stack/targets.json`. The file contains only the version and absolute installation path. Installed `ams` commands work from any directory; no path argument or Compose project hash is needed. The remembered path is a convenience for deferred application, not an installation ownership record.

Server apply verifies the saved Compose provider before building images or proceeding with application. It then checks local image identities and build-input fingerprints, builds missing or outdated images, resolves published ports in the selected engine, saves the chosen ports, regenerates configuration, and recreates containers. The first build downloads pinned sources, base images, and dependencies. The wizard manages `.ams/images.json` automatically; you do not need to supply it. Changing `.env` does not require rebuilding unchanged images. Updating packaged code or image build inputs triggers a cached rebuild before services stop; matching images loaded from a bundle remain reusable offline.

`ams apply` remains available after installation. Once local Core is healthy, apply checks whether it already has an active administrator. Existing administrators keep their keys, even when an earlier attempt started only part of the stack. If Core reports that initial setup is required, AMS automatically generates an administrator key, prints it, and asks you to save it before initialization. There is no generate/manual choice. Other check failures stop application without generating or replacing credentials.

Saved desired configuration remains available if application fails. Image preparation or preflight failures leave runtime configuration and running application containers unchanged. Downloaded sources and build cache can remain for a retry. Saving configuration alone needs no container engine or administrator key.

### Optional: prepare images on another machine

For offline delivery or building on a different host, prepare a [development checkout](development.md#run-from-a-checkout), then use the build/export/load workflow:

```sh
npm run build
npm run build:images -- --runtime podman --platform linux/arm64 --project-dir ./delivery
npm run build:images -- --runtime podman --project-dir ./delivery --export ./images
npm pack
```

For an x86 VPS, build `linux/amd64` images with a compatible builder. Setup checks the actual container engine architecture before initialization. The build produces six application images (including MCP) and one runtime image for support containers. A CLIProxyAPI-only installation needs its application image and the runtime image; deployment preflight accepts a larger manifest without inspecting unused local images.

Distribute the npm archive and image bundle separately. Export creates `images.tar`, `images.json`, and `bundle.json`, plus `tdai-source.json` when TDAI images are included; load verifies checksums, archive contents, platform, image identities, and the TDAI revision. For a configured installation, export includes the images required by its saved `.env`, including helpers. Retained images for disabled services stay local. Without a saved `.env`, export includes the full prepared manifest.

On the destination machine:

```sh
npm install --global ./agent-memory-stack-0.1.0.tgz
node "$(npm root -g)/agent-memory-stack/dist/build/cli.js" --runtime docker --project-dir ./server --load ./images
ams
```

Use `--runtime podman` for Podman image operations. In setup, select Docker Compose, configured `podman compose`, `podman-compose`, or `uvx podman-compose`. Shell aliases such as `docker=podman` are not used. Load images into the same installation directory you select in the wizard; verified images are reused. Container startup itself does not compile applications. These commands do not publish to npm or a registry.

`Podman compose (configured provider)` requires an external Compose provider already configured for `podman compose`. If only Podman and uv are installed, select **Podman + uvx podman-compose**. An unavailable provider now fails before image builds, with instructions for the selected provider.

## ⚙️ 2. Configure the local stack

The editable `.env` lives beside `compose.yaml` in the directory chosen during setup (default: `./ams`). `ams apply` uses the last saved directory. `server/.env.example` is the configuration template; `deploy/` contains the image build files.

After you choose **Configure stack**, and before any configuration question, setup inspects the current user's available Docker and Podman endpoints read-only. The initial menu is always shown; opening it alone does not trigger detection. The five original application service labels must belong to one exact AMS Compose project in one engine. Support/init containers do not count; stopped application containers do. When the group is complete, output points to its `.env` using the project working-directory label if available and exits successfully. No credentials or configuration files are read by this check.

This detects ordinary repeated setup; it does not enforce uniqueness across inaccessible contexts, deleted/partial stacks, concurrent invocations, or other accounts. If no complete group is visible, setup continues, including save-only operation without a running engine. It creates no registry or lock and repairs nothing automatically.

Run `ams` and choose **Configure stack**. The first question suggests `./ams` in the current directory; a remembered installation path takes precedence. Directory prompts display your home directory as `~` and accept `~/...`; AMS expands it before reading or saving files. Relative data paths such as `./data` remain relative to the installation directory. Fresh installations include all six application services:

| Service | Purpose |
| --- | --- |
| Core | Memory storage, users, and permissions |
| Knowledge | Wiki and document processing |
| Panel | Web interface for managing the stack |
| MemoryProxy | Adds memory context to agent requests |
| CLIProxyAPI | Provides API access to supported AI providers |
| MCP | Exposes protected Knowledge tools over Streamable HTTP |

Support containers are added automatically. The wizard displays the configured services and asks no service-selection, dependency-placement, stack-address, port, or interface-enablement questions. An existing explicit `AMS_SERVICES` selection and its advanced network settings remain unchanged. To add MCP to a saved installation, append `mcp` to `AMS_SERVICES` in its `.env` and run `ams apply`. Existing explicit selections are preserved.

The remaining questions cover the installation and data directories, Compose provider, real LLM API base/key, separate Core and Knowledge models, CLIProxyAPI account provider, memory prompt mode, and log level. The provider URL has a neutral placeholder and no preset real endpoint. The wizard automatically reuses saved Core and CLIProxyAPI service keys and generates missing local keys without questions. Explicit keys in `.env` remain authoritative; remote credentials are never generated. The real provider API key remains an interactive input. Administrator handling happens during application. Advanced split deployments are configured through `.env`; missing required fields produce named configuration errors instead of additional topology questions.

**Memory prompt mode** controls what Core extracts and summarizes from conversations. Choose **code** (the default) for project decisions, technical constraints, and reusable team practices; choose **chat** for personal preferences, events, and lasting instructions. This changes Core's memory prompts, not the model used to answer agent requests.

Output-token limits and LLM timeouts are configured directly in `.env`; the wizard does not ask for them and preserves existing values:

| Setting | Stack default |
|---|---|
| `MEMORY_LLM_MAX_TOKENS` | `32000` |
| `KNOWLEDGE_LLM_MAX_TOKENS` | `32768` |
| `MEMORY_LLM_TIMEOUT_MS` | `300000` (5 minutes) |
| `KNOWLEDGE_LLM_TIMEOUT_MS` | `1200000` (20 minutes) |

Core defaults follow the pinned TDAI deployment script, `deploy/global-images/start-memory-core.sh`; Knowledge defaults follow its configuration loader. Core's separate standalone example and bare loader use `4096` tokens and `120000` ms, so the launch path matters. Explicit values already saved in `.env` take precedence. See [the defaults audit](../DEFAULTS-AUDIT.md) for remaining differences from upstream deployment behavior.

### Complete local installation

For Core and Knowledge models, the wizard tries the provider's `GET /models` endpoint using the entered API base and key. A returned list becomes a select menu with a manual-entry option; an unavailable, malformed, or empty list falls back to text input after at most 5 seconds. An explicit HTTP 401/403 response displays an API access error and asks for the key again before model selection; Escape lets you edit earlier answers. Saved model names remain available, including names absent from the list. Discovery runs once per provider/key entry on the machine running the CLI, retries after an access error, and does not send an inference request.

1. Choose **Configure stack**, confirm the **Compose configuration directory** (for `compose.yaml` and `.env`) and Compose provider, and enter your real model-provider settings. Services run in containers.
2. Review and save the configuration. **Apply configuration now? → No** keeps it for later; **Yes** applies it immediately.
3. Application prepares images, resolves ports, and starts Core. For a new Core, save the automatically generated administrator key and confirm **OK**; application then initializes it and starts the remaining services.
4. If the selected CLIProxyAPI account provider needs authorization, complete its optional login flow. Open Panel at the printed address and copy your agent's endpoint and key there.

### Automatic ports

Panel prefers port `8123`; MemoryProxy prefers `8096`; MCP prefers `8425`. Apply first tries the saved preferred ports through the selected Docker/Podman engine. It reuses listeners owned by the same installation and selects free alternatives for conflicts with unrelated listeners. The resulting ports are saved in `.env` and printed after application. Every published listener remains bound to `127.0.0.1`.

Saving alone does not probe ports or require an engine. `.ams/network.json` records generated local origins so later port changes update generated localhost addresses while preserving manually configured Caddy domains. Container-to-container addresses and provider API prefixes remain unchanged. A failed application retains retryable desired settings without claiming that services started.

Knowledge, Core, and CLIProxyAPI have no default host entry points. Knowledge's protected tool gateway remains available inside Compose. MCP uses this internal gateway without publishing it to the host.

### VPS and Caddy

Configure the same full stack on the VPS. After application, use the printed **actual ports** as Caddy upstreams. The example below uses the preferred ports; replace them if apply allocated different ones:

```caddyfile
memory-proxy.my-domain.tld {
    reverse_proxy 127.0.0.1:8096 {
        flush_interval -1
    }
}
panel.my-other-domain.tld {
    reverse_proxy 127.0.0.1:8123
}
knowledge.my-domain.tld {
    reverse_proxy 127.0.0.1:8425 {
        flush_interval -1
    }
}
```

Set `MEMORY_PROXY_PUBLIC_URL` and `PANEL_PUBLIC_URL` in the installation `.env` to your respective origins, then run `ams apply`. Saved external origins survive port reallocation. Preserve request paths and streaming behavior. Use the endpoint paths shown in Panel; AMS does not add another custom routing scheme. Caddy, DNS, TLS, and firewall configuration belong to the operator. Forward MCP's printed port separately, preserving `/mcp`, the `Authorization` header, and MCP session/protocol headers. The remote MCP endpoint in this example is `https://knowledge.my-domain.tld/mcp`.

### CLIProxyAPI account login

CLIProxyAPI supports several AI providers and API formats. Setup asks which account to configure: **ChatGPT (Codex)** or **Claude**. The choice is stored as `CLIPROXY_AUTH_PROVIDER=codex` or `claude`; an absent value defaults to `codex` for compatibility. On an existing installation, change it in `.env` and run `ams apply`.

Apply checks the selected provider's saved authorization before offering login. A matching, non-disabled record with an access or refresh credential skips the question. Otherwise, choose **ChatGPT (Codex)** or **Claude**; the saved provider is selected by default. Choosing another provider saves that preference in `.env` and checks its saved credentials before starting login. Credentials from another provider and a nonempty model list do not count as authorization for the selected provider. The check reads the authorization directory through a read-only helper with networking disabled; read/runtime failures are reported instead of treated as missing login. Saved credentials do not prove token freshness or inference access.

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
| `REMOTE_KNOWLEDGE_TOOLS_URL` | Protected Knowledge tool gateway used by MCP when Knowledge is remote; distinct from its private service API |
| `REMOTE_PANEL_URL` | Panel service base used by Knowledge completion/progress callbacks |
| `*_PUBLIC_URL` | Agent/browser HTTP(S) origin, without credentials, API path, query, or fragment |

Service bases preserve configured path prefixes. Copy agent-specific MemoryProxy endpoint paths from Panel. Explicit direct Knowledge HTTP tools use the configured Knowledge origin with one `/v3` prefix. A reverse proxy publishing a service base under a prefix must route that prefix to the corresponding backend root.

| Published interface | Default loopback port | Audience and authorization |
| --- | --- | --- |
| MemoryProxy (agent API) | `8096` | Agent requests with memory-user and session authorization |
| Knowledge HTTP tools, explicitly enabled | `8422` | Memory-user key, active membership, and asset access checks |
| Panel (web interface) | `8123` | Browser/user interface; authenticated service callbacks share this listener |
| MCP | `8425` | Streamable HTTP `/mcp`; a memory-user Bearer key on every request |
| Core service, explicitly enabled | `8420` | Trusted service consumers using the Core service key |
| CLIProxyAPI service, explicitly enabled | `8317` | Model API consumers using its service key; management routes remain disabled |
| Knowledge service, explicitly enabled | `8423` | Panel's allowlisted Wiki/code-graph operations using the Core service credential |

Every binding is `127.0.0.1`. These are preferred ports, not guaranteed final assignments. Fresh defaults publish Panel, MemoryProxy, and MCP. The underlying Knowledge process is never published directly. Its service adapter supports the pinned Panel Wiki/code-graph routes and uploads; its public tool adapter exposes only protected tool list/call routes. A service credential and a memory-user key serve different audiences.

## 🔑 3. Credentials, settings, and agent connections

Persistent settings live in `<installation>/.env`. `AMS_DEPLOYMENT_VERSION=1` and `AMS_SERVICES` record the canonical selection. `CORE_MODE`, `MODEL_MODE`, `KNOWLEDGE_MODE`, `PANEL_MODE`, and `PROXY_MODE` record resolved local/remote/disabled connections. `*_SERVICE_ENABLED` controls optional service listeners; `*_SERVICE_PORT` sets preferred ports. `KNOWLEDGE_TOOLS_PUBLIC_ENABLED=false` keeps direct Knowledge HTTP tools private by default. An older installation without selection metadata is interpreted as the complete local stack.

Local service keys are generated automatically when missing and reused on later setup runs without prompts. Explicit valid `.env` values are honored; invalid configured keys produce a field-specific error. Locally owned `CORE_API_KEY` and `CLIPROXY_API_KEY` are independent from `REMOTE_CORE_API_KEY` and `REMOTE_MODEL_API_KEY`. Inactive recognized settings are retained so switching a service back on reuses its credentials. Unknown or malformed settings fail explicitly. Validation applies to consumed settings; apply resolves collisions between published port preferences.

Generated keys use `sk-ams-admin-…`, `sk-ams-core-…`, and `sk-ams-cliproxy-…`, with 32 independently generated random bytes encoded as hex. The administrator key is generated automatically only when local Core needs initial setup, displayed before initialization, and passed to bootstrap through stdin. It is not added to `.env`, a separate admin-key file, command arguments, or container environment variables. Core persists its credential database. Save the displayed key yourself; applying an already initialized Core preserves its administrator key without requesting it again. Setup never initializes or repairs a remote Core.

Double-quoted `.env` values use JSON escaping: `\\` represents a backslash, `\"` represents a quote, and `$` stays literal. Derived `.ams/compose.env` contains only image IDs, paths, and ports. Generated YAML/configuration is not another settings authority.

Edit the saved server `.env` and apply it with:

```sh
ams apply
```

Apply reloads current settings and the saved Compose provider, regenerates Compose and service configuration, and recreates the selected containers. A plain container `restart` does not apply changed configuration. Edit service selection and advanced networking through the recognized `.env` fields directly. Generated `compose.yaml` and `.ams/compose.env` are refreshed by application. Cancellation before saving leaves previous settings intact; declining application after saving keeps the new desired settings without touching running containers.

### Knowledge MCP

Use `http://localhost:<MCP_PORT>/mcp` on the service host, or your Caddy HTTPS domain with `/mcp` from another computer. The saved `.env` contains the actual allocated `MCP_PORT`; apply also prints it. Authenticate with `Authorization: Bearer <memory-user-key>` using the intended user key from Panel. Core service keys and the administrator key are not MCP credentials.

The MCP server exposes two discoverable operations: `list_knowledge_tools(knowledge_id)` and `call_knowledge_tool(knowledge_id, tool_name, params)`. Obtain the Wiki or code resource identifier from Panel. List that resource's tools, then call the returned tool name with its argument schema. Resource enumeration is not part of this bridge. The protected gateway checks active user status, asset access, and team membership for each tool operation.

The authenticated boundary verifies the caller on every HTTP request, including session streams and teardown. Supergateway workers are isolated by credential and bound to container loopback. The deployment keeps at most eight workers, with eight concurrent sessions per worker and five-minute idle expiry. User keys exist only in live request/worker memory and private child environments; they are not written to installation configuration. Restarting MCP ends its sessions and does not affect Knowledge or Core data.

For an advanced MCP-only installation, set `AMS_SERVICES=mcp`, `REMOTE_CORE_URL`, `REMOTE_CORE_API_KEY`, and `REMOTE_KNOWLEDGE_TOOLS_URL` in `.env`. The remote protected tools gateway and Core must report the same Core identity. On the machine owning Knowledge, explicitly enable its protected HTTP tool interface and authenticated Core interface for your forwarding. Raw Knowledge service routes are not a substitute for the protected tools URL.

The connection-information action reads `AMS_SERVICES` and resolved `MCP_PORT` from saved `.env`; `.ams/compose.env` carries that port for Compose. It needs no stored user token, domain, or client JSON profile. Removing `mcp` from `AMS_SERVICES` and applying removes its container and generated configuration while preserving Core and Knowledge data.

<details>
<summary>How the bridge differs from upstream stdio and direct HTTP tools</summary>

The upstream [Knowledge MCP server](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryKnowledge/src/mcp/server.ts) uses `stdio`. Its direct Wiki/CodeGraph routes differ from AMS's protected `/v3/tools/list` and `/v3/tools/call` contract. AMS adapts that contract through server-side Supergateway and preserves each caller's memory-user authorization. Register the HTTP endpoint directly in your agent; no local stdio bridge is required. AMS does not install or configure agents.

The protected Knowledge tool gateway stays inside Compose by default. MemoryProxy emits direct Knowledge HTTP tool instructions only when `KNOWLEDGE_TOOLS_PUBLIC_ENABLED=true` is explicitly set in `.env`. This advanced path requires an origin reachable from the agent and a tool capable of making HTTP requests, such as a shell running `curl`. A model connection alone does not register MCP tools or prove Knowledge tool access.

</details>

### Agent connection information

Copy your agent's MemoryProxy Base URL and API key from **Panel → API Keys → Client Access Endpoint**. On the service host, use localhost. On another computer, use your Caddy domain and preserve the endpoint path shown in Panel.

The administrator key and memory-user key are not stored in the installation configuration. Use your saved administrator key to sign into Panel, and obtain the intended user key and authorized team/agent IDs there. Knowledge and MemoryProxy use the same memory-user identity; Core and CLIProxyAPI service keys are not agent credentials.

Run `ams` and choose **Show connection details** to see the saved Panel URL, MemoryProxy port, and MCP port/path. The menu keeps **Configure stack** selected initially; its existing-stack guard does not block Apply or connection details. Successful Apply and TDAI update finish with a reminder to open this screen.

The screen groups each service’s address and matching credentials together. Panel shows its URL/port and administrator login keys. MemoryProxy shows its listener, native Base URL guidance from Panel, and all active user keys; MCP shows its `/mcp` URL, Streamable HTTP transport, and the same user keys. Administrator keys are labeled as full access. Each value appears on its own plain, unwrapped line beneath its label in that service block.

Core and CLIProxyAPI show their service endpoint or internal-only status beside their service key. Internal LLM shows its API base, Core/Knowledge models, and provider key. Saved remote Core/model addresses appear beside their remote keys, explicitly marked inactive when unused. Every configured `.env` secret remains visible, including retained credentials for inactive services; provider/service keys are distinguished from agent credentials.

AMS reads Core’s database without changes: it enumerates active keys once, rechecks each key before reading it once, and repeats the captured values in the applicable service blocks. There is no key-selection prompt. If one key becomes unavailable, the remaining keys still appear. If Core is remote or unavailable, `.env` credentials remain visible; use Panel → API Keys for user keys. AMS creates no key file and does not print these connection details during Apply/update or in container logs. The explicit display can remain in terminal scrollback or capture. Service ports are saved configuration, not a live health check.

With explicit direct Knowledge HTTP exposure enabled, MemoryProxy injects resource-specific HTTP instructions using `KNOWLEDGE_PUBLIC_URL`. The agent's execution environment must supply `AMS_USER_KEY` for those requests and be able to reach that origin. Default private Knowledge emits no direct HTTP tool instructions; ordinary memory and skill instructions remain active.

## 🛠️ 4. Reconfiguration and recovery

State belongs to the machine running each service: `data/core` stores memory and credentials, `data/knowledge` stores Wiki and database state, `data/panel` stores templates, `data/proxy` stores sessions, and `data/cli-proxy-api` stores OAuth files. Selected services run as UID 10001; support containers prepare their directories. Deselection preserves data and reusable keys.

Saving keeps desired `.env` and provider settings separate from previous applied input bytes in restricted `.ams/before-save.json` and `.ams/last-applied-inputs.json` records. During application, a restricted runtime helper snapshots Compose, image/runtime settings, network allocation metadata, the installation TDAI source selection, applied inventory, and generated files into **`.ams/previous-settings/`**; its input files are restored from the previous applied bytes. Thus saving several times or editing `.env` directly does not overwrite the rollback baseline. These records contain secrets and use restricted permissions. **`.ams/apply-pending`** preserves the same snapshot across failed retries; it is removed after a successful apply, including an explicitly accepted staged start. The snapshot contains configuration, not application databases or OAuth data.

`.ams/applied.json` records managed containers; `.ams/readiness.json` records integration results. Only deselected containers belonging to this installation are removed. The project name is stable for its installation directory. Remote services and unrelated projects are not changed.

### Move a service and roll back

1. Back up the old installation's complete data while all its writers are stopped. Keep the matching package and image manifest. Editing AMS_SERVICES does not migrate a database or OAuth identity.
2. Prepare the destination independently and restore compatible data if continuity is required. Keep the source OAuth refresher stopped before starting the same token files elsewhere.
3. On the original machine, remove the service from AMS_SERVICES and configure its remote replacement in .env, and review local removals before applying. Retain the original data and local keys for reversal.
4. To reverse the switch, stop the remote owner if it shares restored state, restore the local service in AMS_SERVICES and its corresponding modes, and reuse its preserved data and key. Compare any divergent data before resuming; there is no automatic synchronization.
5. For configuration rollback, preserve `.ams/previous-settings` outside the installation first, stop its writers, restore the matching saved settings/package/images and compatible data as needed, then use the saved target's explicit apply command. Verify identity, a reference conversation, and Wiki content. An incomplete apply does not promise atomic database rollback.

A cold recovery backup must include **the entire `DATA_DIR`**, `.env`, `compose.yaml`, and the `.ams` directory. Use a tool with permission to read UID 10001 files; restrict the archive to `0600`. Restore into a separate empty directory first. Update `DATA_DIR` in `.env` if the location changes. Restore and inspect the target/container state explicitly; the setup guard and apply heuristic do not provide automatic recovery for restored or incomplete data. Retain only one active OAuth refresher. Back up Caddy/TLS through your separate process.

Use `docker ps -a` or `podman ps -a` to inspect containers. Read logs with `docker logs <container-name>` or `podman logs <container-name>`. Diagnose the failing stage separately: configuration/image checks, local process readiness, service authentication/pairing, provider authorization, or agent/semantic behavior. Process health does not prove usable Wiki integration or model access.

## 🧪 5. Validation status

The acceptance criterion for the current delivery stage is **required images built and selected containers started**. Comprehensive agent, MCP, provider, memory/Wiki, authorization, and recovery validation follows Supergateway and the remaining integrations. [VALIDATION.md](../VALIDATION.md) preserves the existing test evidence and describes those deferred scenarios separately.
