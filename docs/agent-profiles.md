# 🧠 Connect Codex and Claude Code

Run these commands **on the computer where you use your agent**. The stack can run on that computer or on a VPS.

| Connection | What it adds |
| --- | --- |
| MemoryProxy Base URL + memory-user key | Model requests with memory context |
| MCP URL + memory-user key | Knowledge tools for Wiki and code resources |

You can enable either connection or both. CLIProxyAPI is the stack's upstream model service; the agent connects to **MemoryProxy** for memory.

The examples use Bash or Zsh (macOS, Linux, or WSL) and an already installed `codex` or `claude` CLI. They define reusable shell commands, without editing the agents' TOML or JSON configuration.

## 1. Get your endpoints and key

On the stack machine, run `ams` → **Show connection details** to find Panel, MemoryProxy, and MCP.

In **Panel → API Keys → Client Access Endpoint**, copy the **Codex** or **Claude Code** endpoint for your instance. Use your saved **memory-user API key**, or create a key while signed in as the intended user and copy the full value when it is shown. Existing key rows display only a prefix.

Use the user key for both connections. The Panel administrator key and the Core/CLIProxyAPI service keys serve different purposes.

| Where the agent runs | Address to use |
| --- | --- |
| On the stack machine | `http://localhost:<published-port>` plus the endpoint path |
| On another computer | Your Caddy HTTPS domain plus the same endpoint path |

For example, Panel might show `http://localhost:8096/codex/default` and `http://localhost:8096/claude-code/default`. Your instance name and ports may differ. Copy the paths exactly; do not append `/v1`. When using Caddy, replace the origin and preserve the path. MCP uses its own port/domain and `/mcp`.

Read the key into the current terminal without putting its value in a command:

```sh
printf 'Memory-user API key: '
read -r -s AMS_USER_API_KEY
printf '\n'
export AMS_USER_API_KEY
```

Repeat this in each new terminal, or supply `AMS_USER_API_KEY` through your own secret manager.

## 2. Codex: create a launch profile

Replace `PASTE_CODEX_BASE_URL` with the endpoint from Panel, and `YOUR_CODEX_MODEL` with a model available through the stack's authorized upstream provider. This is the agent's model; Core and Knowledge have their own model settings.

Paste this function into your terminal:

```sh
codex-ams() {
  codex \
    --config 'model_provider="ams"' \
    --config 'model_providers.ams.name="AMS MemoryProxy"' \
    --config 'model_providers.ams.base_url="PASTE_CODEX_BASE_URL"' \
    --config 'model_providers.ams.env_key="AMS_USER_API_KEY"' \
    --config 'model_providers.ams.wire_api="responses"' \
    --model 'YOUR_CODEX_MODEL' \
    "$@"
}
```

Start it from your project:

```sh
codex-ams
```

These CLI overrides select MemoryProxy for this launch. Running `codex` directly uses your usual configuration. The function is a shell shortcut, rather than a Codex `--profile` file. See the official [Codex CLI overrides and custom providers](https://developers.openai.com/codex/config-advanced/).

On the first conversation, follow MemoryProxy's team, agent, and task initialization prompts. The pinned upstream [Codex guide](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/0468a2a5b50eaafc54758ed1e2e6609472e5b6ce/agents/codex/README.md) requires completing this in Plan mode before switching to normal work.

## 3. Claude Code: create a launch profile

Replace `PASTE_CLAUDE_CODE_BASE_URL` with the **Claude Code** endpoint from Panel, and `YOUR_CLAUDE_MODEL` with an available upstream model ID.

```sh
claude-ams() {
  ANTHROPIC_BASE_URL='PASTE_CLAUDE_CODE_BASE_URL' \
  ANTHROPIC_AUTH_TOKEN="$AMS_USER_API_KEY" \
  ANTHROPIC_API_KEY='' \
  claude --model 'YOUR_CLAUDE_MODEL' "$@"
}
```

Start it from your project:

```sh
claude-ams
```

The variables apply to this process. `ANTHROPIC_AUTH_TOKEN` sends the memory-user key as a Bearer token. In Claude Code, run `/status` to inspect the active connection. If an existing settings file sets gateway variables, those values can override the shell environment; remove that conflict before using this shortcut. See [Claude Code gateway configuration](https://code.claude.com/docs/en/llm-gateway-connect).

### Keep your launch commands

To keep both functions in new Zsh terminals, run once after defining them:

```sh
typeset -f codex-ams claude-ams >> ~/.zshrc
```

For Bash, use `~/.bashrc` instead. If you defined only one function, include only its name. This saves the commands and endpoints; the user key still comes from `AMS_USER_API_KEY` in each terminal. To change a saved command later, edit its function in your shell startup file.

## 4. Optional: connect Knowledge MCP

Use the MCP address printed by AMS, for example `http://localhost:8425/mcp`, or your Caddy URL such as `https://knowledge.my-domain.tld/mcp`. Replace `YOUR_MCP_URL` below. Run the command for the agent you use.

**Codex:**

```sh
codex mcp add ams-knowledge \
  --url 'YOUR_MCP_URL' \
  --bearer-token-env-var AMS_USER_API_KEY
```

**Claude Code:**

```sh
claude mcp add --transport http --scope user \
  ams-knowledge 'YOUR_MCP_URL' \
  --header 'Authorization: Bearer ${AMS_USER_API_KEY}'
```

Keep the header's single quotes: Claude Code expands the variable when connecting. These commands save the MCP registration in your agent's configuration; they apply to ordinary launches too. The key must be available in the environment of the process launching the agent. See the official [Codex MCP](https://developers.openai.com/codex/mcp/) and [Claude Code MCP](https://code.claude.com/docs/en/mcp) guides.

Restart the agent and open `/mcp` to check the connection. Give it a Wiki or code resource ID from Panel and ask it to list that resource's Knowledge tools. Access follows the user's team membership and resource permissions. See [Knowledge MCP](operations.md#knowledge-mcp) for the tool contract.

## 5. Check your first session

Start `codex-ams` or `claude-ams`, complete memory initialization, and send a short request. Confirm the session appears in Panel. If you also enabled MCP, check it separately with `/mcp`: a working model connection alone does not verify Knowledge access.

| Symptom | Check |
| --- | --- |
| Connection refused | Stack running, actual published port, and localhost versus remote domain |
| HTTP 401/403 | Full memory-user key, active user, and resource permissions |
| HTTP 404 on model requests | Correct agent-specific path and instance copied from Panel; Caddy preserves the path |
| Unknown model | Model available through the stack's authorized upstream account |
| Missing MCP tools | MCP registration, `/mcp` URL, exported key, and resource ID |

For stack configuration and provider login, return to [Setup and operations](operations.md).
