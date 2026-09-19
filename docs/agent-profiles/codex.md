# Codex with Agent Memory Stack

[All agent profiles](README.md) · [Get your endpoints and key](README.md#get-your-endpoints-and-key)

Run these commands on the agent's computer after exporting `AMS_USER_API_KEY` as described in the shared setup.

The example uses the local AMS instance and `gpt-6-astra`. Use a model available through your stack's authorized upstream provider, and adjust the host and port for your installation. This is the agent's model; Core and Knowledge have their own model settings.

### Command line or TOML

The TOML provider fields below belong under `[model_providers.ams]`; `model_provider` and `model` are top-level settings.

| Setting | CLI | TOML |
| --- | --- | --- |
| Provider | `--config 'model_provider="ams"'` | `model_provider = "ams"` |
| Display name | `--config 'model_providers.ams.name="AMS MemoryProxy"'` | `name = "AMS MemoryProxy"` |
| Base URL | `--config 'model_providers.ams.base_url="http://127.0.0.1:8096/codex/ams/v1"'` | `base_url = "http://127.0.0.1:8096/codex/ams/v1"` |
| Key variable | `--config 'model_providers.ams.env_key="AMS_USER_API_KEY"'` | `env_key = "AMS_USER_API_KEY"` |
| Protocol | `--config 'model_providers.ams.wire_api="responses"'` | `wire_api = "responses"` |
| Agent model | `--model 'gpt-6-astra'` | `model = "gpt-6-astra"` |

### Launch directly

```sh
codex \
  --config 'model_provider="ams"' \
  --config 'model_providers.ams.name="AMS MemoryProxy"' \
  --config 'model_providers.ams.base_url="http://127.0.0.1:8096/codex/ams/v1"' \
  --config 'model_providers.ams.env_key="AMS_USER_API_KEY"' \
  --config 'model_providers.ams.wire_api="responses"' \
  --model 'gpt-6-astra' \
  "$@"
```

`"$@"` forwards arguments when you use the command in a shell function or script. These overrides apply to this launch.

### Save a named profile

Create `~/.codex/ams.config.toml` with:

```toml
model_provider = "ams"
model = "gpt-6-astra"

[model_providers.ams]
name = "AMS MemoryProxy"
base_url = "http://127.0.0.1:8096/codex/ams/v1"
env_key = "AMS_USER_API_KEY"
wire_api = "responses"
```

Launch the profile from your project:

```sh
codex --profile ams
```

Codex layers `ams.config.toml` over your base `~/.codex/config.toml`. The profile stores the environment variable's name; set `AMS_USER_API_KEY` in the terminal before launching. Running `codex` directly uses your usual configuration. See the official [Codex profiles and custom providers](https://developers.openai.com/codex/config-advanced/).

For a shorter command, define:

```sh
codex-ams() {
  codex --profile ams "$@"
}
```

On the first conversation, follow MemoryProxy's team, agent, and task initialization prompts. The pinned upstream [Codex guide](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/0468a2a5b50eaafc54758ed1e2e6609472e5b6ce/agents/codex/README.md) requires completing this in Plan mode before switching to normal work.

### Keep the launch shortcut

After defining `codex-ams`, save it for new Zsh terminals:

```sh
typeset -f codex-ams >> ~/.zshrc
```

For Bash, use `~/.bashrc` instead. This saves the function; supply its environment variables in each terminal.

## Optional: connect Knowledge MCP

Replace `YOUR_MCP_URL` with the MCP address from AMS, for example `http://127.0.0.1:8425/mcp`, or your Caddy HTTPS domain with `/mcp`.

```sh
codex mcp add ams-knowledge \
  --url 'YOUR_MCP_URL' \
  --bearer-token-env-var AMS_USER_API_KEY
```

The registration is saved in Codex configuration and also applies to ordinary launches. Keep `AMS_USER_API_KEY` exported when launching Codex. Restart Codex and open `/mcp` to check the connection. See [Codex MCP](https://developers.openai.com/codex/mcp/).

Give the agent a Wiki or code resource ID from Panel and ask it to list that resource's Knowledge tools. Access follows the user's team membership and resource permissions. See [Knowledge MCP](../operations.md#knowledge-mcp) and [connection checks](README.md#check-your-first-session).
