# 🧠 Agent Memory Stack

**Your AI subscription, with a memory stack you run yourself.**

Agent Memory Stack (AMS) brings TencentDB Agent Memory together with CLIProxyAPI and a remote MCP server. Give your coding agent persistent memory, reusable skills, and access to project knowledge while using your existing model accounts. Run the stack on your laptop or a VPS, and keep working in Codex, Claude Code, or another compatible agent.

**Built with:**

- [TencentDB Agent Memory (TDAI)](https://github.com/TencentCloud/TencentDB-Agent-Memory) — memory, skills, Wiki, CodeGraph, MemoryProxy, and the web panel.
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — connects your AI accounts and subscriptions to the stack's models.
- [Supergateway](https://github.com/supercorp-ai/supergateway) — bridges the Knowledge MCP server from stdio to Streamable HTTP, with user authentication and access checks provided by AMS.

## ✨ What you get

- **Memory across conversations.** Keep project decisions, preferences, and useful context in your own stack. MemoryProxy brings relevant memory into the agent's model requests.
- **Reusable skills.** TencentDB Agent Memory extracts and manages skills, and MemoryProxy supplies relevant skill instructions to your agent. This adds part of the agent harness around the coding tool you already use.
- **Wiki and CodeGraph.** Turn documents into project knowledge and explore indexed code through TencentDB's Knowledge tools.
- **Your model accounts, connected.** CLIProxyAPI connects the agent's model requests to supported providers. AMS includes account login for ChatGPT (Codex) and Claude.
- **MCP that can live on your server.** Connect to Knowledge over authenticated Streamable HTTP. The stdio bridge runs inside the stack, so your agent connects with an MCP URL and a user key.

## 🔗 Bring your subscription and choose your memory models

The core idea is simple: **combine TencentDB's memory and knowledge with the model access you already have.** AMS brings the services together in one Compose project, with a web panel for users, keys, and resources.

| Models for memory and Knowledge | How it fits |
| --- | --- |
| **Use this stack's CLIProxyAPI** — default for a fresh full stack | Reuse your signed-in model account for agent inference, memory processing, and Knowledge; no extra API address or key to enter |
| **Connect another model API** — optional | Supply a separate API base URL and key for Core and Knowledge while the agent continues through CLIProxyAPI |

Choose the Core memory model and Knowledge model independently in either mode. Your agent still chooses its own model. Sharing CLIProxyAPI shares account capacity; choosing a separate external API keeps internal processing on that provider. The account-login menu offers ChatGPT (Codex) and Claude.

With the default local route, setup can save configuration before Docker/Podman is running. On apply, AMS starts CLIProxyAPI, completes account login if needed, then asks for any missing Core/Knowledge model choices. Cancel and run `ams apply` later to resume: confirmed models and completed login are retained. Existing installations keep their explicit external settings until you choose the shared route.

## 🗺️ How it fits together

[![Agent Memory Stack: MemoryProxy and MCP are separate agent connections; memory and Knowledge models share CLIProxyAPI by default or use an optional external API.](https://raw.githubusercontent.com/shura-v/agent-memory-stack/main/docs/images/agent-memory-stack-overview.png)](https://shura-v.github.io/agent-memory-stack/architecture/stack.html)

**Explore the interactive diagrams:** [Stack overview](https://shura-v.github.io/agent-memory-stack/architecture/stack.html) · [Inside the MCP bridge](https://shura-v.github.io/agent-memory-stack/architecture/mcp.html).

Visit the [documentation site](https://shura-v.github.io/agent-memory-stack/) for both maps and the setup and development guides.

## 🧩 Two connections for your agent

**MemoryProxy is the model API with memory. MCP is the connection to Knowledge tools.** You can configure either one or both.

| | MemoryProxy | Knowledge MCP |
| --- | --- | --- |
| What it gives the agent | Memory context and skill instructions around model requests | Tools for Wiki and CodeGraph resources |
| What you configure | The agent-specific Base URL and API key from Panel | A Streamable HTTP server at `/mcp` and a memory-user key |
| Where to connect | The local MemoryProxy port or your reverse-proxy domain | The local MCP port or your reverse-proxy domain |

On the same machine, use localhost. For a VPS, put Caddy in front of the published ports and use your HTTPS domains. Panel, MemoryProxy, and MCP bind to localhost by default; you decide how to make them reachable remotely.

AMS runs the MCP HTTP-to-stdio bridge on the server and checks the caller's user, team, and resource permissions. Your agent connects directly over HTTP, without a local bridge process. You keep control of the agent's configuration.

## 🚀 Start setup

![Agent Memory Stack setup walkthrough](https://raw.githubusercontent.com/shura-v/agent-memory-stack/main/docs/images/agent-memory-stack-setup.gif)

You need **Node.js 24+** and **Docker or Podman with Compose** on the machine that will run the stack.

```sh
npm install -g agent-memory-stack
ams
```

1. Choose **Configure stack** and select your CLIProxyAPI account provider first. Then, under **Models for memory and Knowledge**, keep **Use this stack's CLIProxyAPI** or choose **Connect another model API**.
2. Apply the configuration. For the shared route, complete account login and select separate Core/Knowledge models when prompted. AMS then starts the remaining services; save the administrator key for a new Core.
3. Choose **Show connection details** to find Panel, MemoryProxy, and MCP. Open Panel to get your agent’s Base URL and user API key.

The first build downloads sources and dependencies and can take several minutes. Configuration always lives in `~/.agent-memory-stack`: `.env`, `compose.yaml`, and `.ams/`. The default data path is `./data` inside that folder; edit `DATA_DIR` in `.env` to change it.

For later changes, edit the saved `.env` and run `ams apply`. To update TencentDB Agent Memory on the installation, run `ams update tdai`.

## 📚 Guides

| Guide | What you will find |
| --- | --- |
| [Setup and operations](https://github.com/shura-v/agent-memory-stack/blob/main/docs/operations.md) | Configuration, provider login, Caddy, MCP connections, and recovery |
| [Connect Codex and Claude Code](https://github.com/shura-v/agent-memory-stack/blob/main/docs/agent-profiles.md) | CLI launch profiles for MemoryProxy and commands to add Knowledge MCP |
| [Updating TDAI](https://github.com/shura-v/agent-memory-stack/blob/main/docs/updating-tdai.md) | Update the upstream services on your installation |
| [Architecture](https://shura-v.github.io/agent-memory-stack/architecture/stack.html) | Interactive map of the stack on GitHub Pages |

## 🧑‍💻 For developers

Working on AMS itself? Start with the [development guide](https://github.com/shura-v/agent-memory-stack/blob/main/docs/development.md) for running from source, checking changes, and building a local npm package.

AMS is written in TypeScript. The [validation notes](https://github.com/shura-v/agent-memory-stack/blob/main/VALIDATION.md) distinguish automated checks from live container and provider acceptance; the [defaults audit](https://github.com/shura-v/agent-memory-stack/blob/main/DEFAULTS-AUDIT.md) explains configuration differences from upstream.
