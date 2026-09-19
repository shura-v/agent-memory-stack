# Claude Code with Agent Memory Stack

[All agent profiles](README.md) · [Get your endpoints and key](README.md#get-your-endpoints-and-key)

Run these commands on the agent's computer after exporting `AMS_USER_API_KEY` as described in the shared setup.

The example uses the local AMS instance and `claude-sonnet-4-6`. Use a model available through your stack's authorized upstream provider, and adjust the host and port for your installation. Copy the **Claude Code** path from Panel without adding `/v1`.

### Command line or JSON

Claude Code accepts a separate settings file with `--settings`. The `env` fields below belong inside its `env` object; `model` is a top-level setting.

| Setting | CLI | JSON settings |
| --- | --- | --- |
| Base URL | `ANTHROPIC_BASE_URL='http://127.0.0.1:8096/claude-code/ams'` | `"ANTHROPIC_BASE_URL": "http://127.0.0.1:8096/claude-code/ams"` |
| User key | `ANTHROPIC_AUTH_TOKEN="$AMS_USER_API_KEY"` | Supplied through the environment at launch; kept out of the file |
| Clear a separate API key | `ANTHROPIC_API_KEY=''` | `"ANTHROPIC_API_KEY": ""` |
| Agent model | `--model 'claude-sonnet-4-6'` | `"model": "claude-sonnet-4-6"` |

### Launch directly

```sh
ANTHROPIC_BASE_URL='http://127.0.0.1:8096/claude-code/ams' \
ANTHROPIC_AUTH_TOKEN="$AMS_USER_API_KEY" \
ANTHROPIC_API_KEY='' \
claude --model 'claude-sonnet-4-6' "$@"
```

The variables apply to this process. `ANTHROPIC_AUTH_TOKEN` sends the memory-user key as a Bearer token. In Claude Code, run `/status` to inspect the active connection. If an existing settings file sets gateway variables, those values can override the shell environment; remove that conflict before using this command. See [Claude Code gateway configuration](https://code.claude.com/docs/en/llm-gateway-connect).

### Save a settings profile

Create `~/.claude/ams.settings.json` with:

```json
{
  "model": "claude-sonnet-4-6",
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8096/claude-code/ams",
    "ANTHROPIC_API_KEY": ""
  }
}
```

Launch from your project, supplying the user key from the terminal:

```sh
ANTHROPIC_AUTH_TOKEN="$AMS_USER_API_KEY" \
claude --settings "$HOME/.claude/ams.settings.json"
```

The file stores the endpoint and model; the key stays in the launch environment. `--settings` overlays these fields for the session and keeps your other settings. See the official [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags).

For a shorter command, define:

```sh
claude-ams() {
  ANTHROPIC_AUTH_TOKEN="$AMS_USER_API_KEY" \
  claude --settings "$HOME/.claude/ams.settings.json" "$@"
}
```

### Keep the launch shortcut

After defining `claude-ams`, save it for new Zsh terminals:

```sh
typeset -f claude-ams >> ~/.zshrc
```

For Bash, use `~/.bashrc` instead. This saves the function; supply its environment variables in each terminal.

## Optional: connect Knowledge MCP

Replace `YOUR_MCP_URL` with the MCP address from AMS, for example `http://127.0.0.1:8425/mcp`, or your Caddy HTTPS domain with `/mcp`.

```sh
claude mcp add --transport http --scope user \
  ams-knowledge 'YOUR_MCP_URL' \
  --header 'Authorization: Bearer ${AMS_USER_API_KEY}'
```

Keep the header's single quotes: Claude Code expands the variable when connecting. The registration is saved at user scope and also applies to ordinary launches. Keep `AMS_USER_API_KEY` exported. Restart Claude Code and open `/mcp` to check the connection. See [Claude Code MCP](https://code.claude.com/docs/en/mcp).

Give the agent a Wiki or code resource ID from Panel and ask it to list that resource's Knowledge tools. Access follows the user's team membership and resource permissions. See [Knowledge MCP](../operations.md#knowledge-mcp) and [connection checks](README.md#check-your-first-session).
