# 🧠 Agent profiles

Run these commands **on the computer where you use your agent**. The stack can run on that computer or on a VPS.

| Connection | What it adds |
| --- | --- |
| MemoryProxy Base URL + memory-user key | Model requests with memory context |
| MCP URL + memory-user key | Knowledge tools for Wiki and code resources |

You can enable either connection or both. CLIProxyAPI is the stack's upstream model service; the agent connects to **MemoryProxy** for memory.

The examples use Bash or Zsh (macOS, Linux, or WSL) and an already installed `codex`, `claude`, or `hermes` CLI. Choose a CLI launch command or a saved configuration for your agent.

## Choose your agent

| Agent | Model protocol | Guide |
| --- | --- | --- |
| Codex | Responses | [CLI and TOML profile](codex.md) |
| Claude Code | Messages | [CLI and JSON settings](claude.md) |
| Hermes | Chat Completions | [CLI and YAML profile](hermes.md) |

## Get your endpoints and key

On the stack machine, run `ams` → **Show connection details**. The final **Agent connections** section, after the visible separator, contains MemoryProxy and MCP addresses with user keys and a link back to these guides. Panel and internal service details appear above it.

In **Panel → API Keys → Client Access Endpoint**, copy the **Codex** or **Claude Code** endpoint for your instance. Use your saved **memory-user API key**, or create a key while signed in as the intended user and copy the full value when it is shown. Existing key rows display only a prefix.

Use the user key for both connections. The Panel administrator key, native MemoryProxy `admin.apiKey`, and Core/CLIProxyAPI service keys serve different purposes.

| Where the agent runs | Address to use |
| --- | --- |
| On the stack machine | `http://localhost:<published-port>` plus the endpoint path |
| On another computer | Your Caddy HTTPS domain plus the same endpoint path |

For the AMS instance, Panel shows paths such as `/codex/ams` and `/claude-code/ams`. Use the full agent-specific path, including the instance. When using Caddy, replace the origin and preserve the path. MCP uses its own port/domain and `/mcp`.

For a VPS, follow [Publish the stack through Caddy](../caddy.md) to expose the agent interfaces and Panel while keeping backend services private.

| Agent | Base URL in these examples | Request path sent by the client |
| --- | --- | --- |
| Codex | `http://127.0.0.1:8096/codex/ams/v1` | `/codex/ams/v1/responses` |
| Claude Code | `http://127.0.0.1:8096/claude-code/ams` | `/claude-code/ams/v1/messages` |
| Hermes | `http://127.0.0.1:8096/hermes/ams/v1` | `/hermes/ams/v1/chat/completions` |

Codex appends `/responses`; Claude Code appends `/v1/messages`. Keep `/v1` in the Codex example and leave it out of the Claude Code Base URL. The bare origin `http://127.0.0.1:8096` is not an agent endpoint.

Read the key into the current terminal without putting its value in a command:

```sh
printf 'Memory-user API key: '
read -r -s AMS_USER_API_KEY
printf '\n'
export AMS_USER_API_KEY
```

Repeat this in each new terminal, or supply `AMS_USER_API_KEY` through your own secret manager.


## Check your first session

Start your agent with its configured profile, complete memory initialization, and send a short request. Confirm the session appears in Panel. If you also enabled MCP, check it separately: a working model connection alone does not verify Knowledge access.

AMS runs the selected TDAI revision unchanged and leaves Core service authentication unset by default; it does not generate Core `server.apiKey`. MemoryProxy still verifies your Core user key. If you explicitly configure a Core service key, the pinned Proxy omits its service Bearer during user verification and can fail with HTTP 401. The separate AMS MCP access boundary supports the configured service credential and retains user/resource checks. Check both connections independently; healthy containers do not establish successful inference. See [native authentication settings](../native-configs.md#core-service-authentication) and [validation and known limits](../../VALIDATION.md).

| Symptom | Check |
| --- | --- |
| Connection refused | Stack running, actual published port, and localhost versus remote domain |
| HTTP 401/403 | Full memory-user key, active user, and resource permissions |
| HTTP 404 on model requests | Correct Base URL from your agent guide, including its instance and API suffix; Caddy preserves the path |
| Unknown model | Model available through the stack's authorized upstream account |
| Missing MCP tools | MCP registration, `/mcp` URL, exported key, and resource ID |

For stack configuration and provider login, return to [Setup and operations](../operations.md).
