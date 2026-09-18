# 🧠 Agent Memory Stack

**Your AI subscription, with a memory stack you run yourself.**

Agent Memory Stack (AMS) brings TencentDB Agent Memory together with CLIProxyAPI and a remote MCP server. Give your coding agent persistent memory, reusable skills, and access to project knowledge while using your existing model accounts. Run the stack on your laptop or a VPS, and keep working in Codex, Claude Code, or another compatible agent.

## ✨ What you get

- **Memory across conversations.** Keep project decisions, preferences, and useful context in your own stack. MemoryProxy brings relevant memory into the agent's model requests.
- **Reusable skills.** TencentDB Agent Memory extracts and manages skills, and MemoryProxy supplies relevant skill instructions to your agent. This adds part of the agent harness around the coding tool you already use.
- **Wiki and CodeGraph.** Turn documents into project knowledge and explore indexed code through TencentDB's Knowledge tools.
- **Your model accounts, connected.** CLIProxyAPI connects the agent's model requests to supported providers. AMS includes account login for ChatGPT (Codex) and Claude.
- **MCP that can live on your server.** Connect to Knowledge over authenticated Streamable HTTP. The stdio bridge runs inside the stack, so your agent connects with an MCP URL and a user key.

## 🔗 Bring your subscription and choose your memory models

The core idea is simple: **combine TencentDB's memory and knowledge with the model access you already have.** AMS brings the services together in one Compose project, with a web panel for users, keys, and resources.

| Model access | How it fits |
| --- | --- |
| ChatGPT subscription / Codex | Sign in through CLIProxyAPI for the agent's model requests |
| Claude subscription | Sign in through CLIProxyAPI for the agent's model requests |
| z.ai or another compatible model API | Supply an API base URL and key for Core and Knowledge processing |

The agent's model and the models that organize memory and knowledge are configured separately. For example, you can use Codex for coding and z.ai for memory processing, choosing a separate model for Knowledge. API credentials for internal processing are entered separately from account login. More provider setup options are planned; the current account-login menu offers Codex and Claude.

## 🗺️ How it fits together

[![Agent Memory Stack: an agent connects to MemoryProxy for model requests with memory, and separately to MCP for protected Knowledge tools.](https://raw.githubusercontent.com/shura-v/agent-memory-stack/main/docs/images/agent-memory-stack-overview.png)](https://shura-v.github.io/agent-memory-stack/architecture/stack.html)

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

You need **Node.js 24+** and **Docker or Podman with Compose** on the machine that will run the stack.

```sh
npm install -g agent-memory-stack
ams
```

1. Choose **Configure stack** and follow the prompts for your model API and account provider.
2. Apply the configuration. AMS builds the images and starts the services. Save the administrator key when prompted and complete provider login.
3. Choose **Show connection details** to find Panel, MemoryProxy, and MCP. Open Panel to get your agent’s Base URL and user API key.

The first build downloads sources and dependencies and can take several minutes. Configuration is saved in `./ams` by default; you can choose another directory.

For later changes, edit the saved `.env` and run `ams apply`. To update TencentDB Agent Memory on the installation, run `ams update tdai`.

## 📚 Guides

| Guide | What you will find |
| --- | --- |
| [Setup and operations](https://github.com/shura-v/agent-memory-stack/blob/main/docs/operations.md) | Configuration, provider login, Caddy, MCP connections, and recovery |
| [Updating TDAI](https://github.com/shura-v/agent-memory-stack/blob/main/docs/updating-tdai.md) | Update the upstream services on your installation |
| [Architecture](https://shura-v.github.io/agent-memory-stack/architecture/stack.html) | Interactive map of the stack on GitHub Pages |

## 🧑‍💻 For developers

Working on AMS itself? Start with the [development guide](https://github.com/shura-v/agent-memory-stack/blob/main/docs/development.md) for running from source, checking changes, and building a local npm package.

AMS is written in TypeScript. The [validation notes](https://github.com/shura-v/agent-memory-stack/blob/main/VALIDATION.md) distinguish automated checks from live container and provider acceptance; the [defaults audit](https://github.com/shura-v/agent-memory-stack/blob/main/DEFAULTS-AUDIT.md) explains configuration differences from upstream.
