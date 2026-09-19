# Hermes with Agent Memory Stack

[All agent profiles](README.md) · [Get your endpoints and key](README.md#get-your-endpoints-and-key)

Run these commands on the agent's computer after exporting `AMS_USER_API_KEY` as described in the shared setup.

Hermes uses Chat Completions through MemoryProxy. Use `http://127.0.0.1:8096/hermes/ams/v1`, adjusting the host and port. Panel's Hermes entry currently hardcodes `/hermes/default`; for this stack use instance **`ams`** and include **`/v1`**.

### Command line or YAML

Create a separate profile once. `--no-alias` skips automatic shell alias creation; the launch shortcut is defined below:

```sh
hermes profile create hermes-ams --no-alias
```

Run each setting command with the prefix `hermes -p hermes-ams`. The YAML equivalents belong in `~/.hermes/profiles/hermes-ams/config.yaml`.

| Setting | CLI after `hermes -p hermes-ams` | YAML |
| --- | --- | --- |
| Provider | `config set model.provider ams` | `model.provider: ams` |
| Base URL | `config set providers.ams.api http://127.0.0.1:8096/hermes/ams/v1` | `providers.ams.api: http://127.0.0.1:8096/hermes/ams/v1` |
| Key variable | `config set providers.ams.key_env AMS_USER_API_KEY` | `providers.ams.key_env: AMS_USER_API_KEY` |
| Protocol | `config set providers.ams.transport chat_completions` | `providers.ams.transport: chat_completions` |
| Agent model | `config set model.default gpt-6-astra` | `model.default: gpt-6-astra` |

The YAML column uses dotted names to identify fields; the complete nested example is below. Use a model available through your authorized upstream account.

Configure the profile through the CLI:

```sh
hermes -p hermes-ams config set model.provider ams
hermes -p hermes-ams config set model.default gpt-6-astra
hermes -p hermes-ams config set providers.ams.api http://127.0.0.1:8096/hermes/ams/v1
hermes -p hermes-ams config set providers.ams.key_env AMS_USER_API_KEY
hermes -p hermes-ams config set providers.ams.transport chat_completions
hermes -p hermes-ams config set providers.ams.extra_headers.x-team-id '${AMS_TEAM_ID}'
hermes -p hermes-ams config set providers.ams.extra_headers.x-agent-id '${AMS_AGENT_ID}'
hermes -p hermes-ams config set providers.ams.extra_headers.x-conversation-id '${AMS_CONVERSATION_ID}'
```

Equivalent settings in the profile's `config.yaml`:

```yaml
model:
  provider: ams
  default: gpt-6-astra
providers:
  ams:
    api: http://127.0.0.1:8096/hermes/ams/v1
    key_env: AMS_USER_API_KEY
    transport: chat_completions
    extra_headers:
      x-team-id: "${AMS_TEAM_ID}"
      x-agent-id: "${AMS_AGENT_ID}"
      x-conversation-id: "${AMS_CONVERSATION_ID}"
```

Keep the CLI's single quotes and the YAML's environment references intact. Hermes resolves them when loading the profile. See [Hermes custom providers](https://hermes-agent.nousresearch.com/docs/integrations/providers#named-custom-providers) and [profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles).

### Start a conversation with memory

Use authorized team and agent IDs from Panel. Set them alongside `AMS_USER_API_KEY` in your terminal, then generate a conversation ID with `uuidgen`:

```sh
export AMS_TEAM_ID='YOUR_TEAM_ID'
export AMS_AGENT_ID='YOUR_AGENT_ID'
export AMS_CONVERSATION_ID="$(uuidgen)"
hermes -p hermes-ams chat
```

MemoryProxy uses these headers to associate the conversation with your team and agent. Without a conversation ID, the pinned TDAI handler skips memory injection. Keep the same ID when resuming a conversation. For a new conversation, exit Hermes, generate a new UUID, and start a new process. An in-process `/new` would keep the same configured header ID. Set all three variables before launching. An optional `x-task-id` can identify an existing authorized task.

This integration uses Chat Completions, so keep the transport explicit. MemoryProxy does not expose a model catalog at this endpoint; select the model explicitly. The header contract follows the pinned [TDAI Hermes integration](https://github.com/TencentCloud/TencentDB-Agent-Memory/tree/0468a2a5b50eaafc54758ed1e2e6609472e5b6ce/agents/hermes), with task selection optional in the implementation.

For a shorter command, define:

```sh
hermes-ams() {
  hermes -p hermes-ams chat "$@"
}
```

### Keep the launch shortcut

After defining `hermes-ams`, save it for new Zsh terminals:

```sh
typeset -f hermes-ams >> ~/.zshrc
```

For Bash, use `~/.bashrc` instead. This saves the function; supply its environment variables in each terminal.

## Optional: connect Knowledge MCP

Replace `YOUR_MCP_URL` with the MCP address from AMS, for example `http://127.0.0.1:8425/mcp`, or your Caddy HTTPS domain with `/mcp`.

```sh
hermes -p hermes-ams config set mcp_servers.ams-knowledge.url 'YOUR_MCP_URL'
hermes -p hermes-ams config set mcp_servers.ams-knowledge.headers.Authorization 'Bearer ${AMS_USER_API_KEY}'
hermes -p hermes-ams mcp test ams-knowledge
```

Hermes expands the header variable when connecting. These commands save the endpoint and key reference in the `hermes-ams` profile and test the connection. Keep `AMS_USER_API_KEY` exported. See [Hermes MCP configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

Give the agent a Wiki or code resource ID from Panel and ask it to list that resource's Knowledge tools. Access follows the user's team membership and resource permissions. See [Knowledge MCP](../operations.md#knowledge-mcp) and [connection checks](README.md#check-your-first-session).
