# Agent Memory Stack architecture

Open the standalone HTML files in a browser. Each includes light/dark themes, zoom, component inspection, source links and export controls; no server is required.

| Diagram | What it explains |
| --- | --- |
| [Stack overview](stack.html) | Agent inference, memory, internal LLM processing, Knowledge tools and Panel |
| [Inside the MCP bridge](mcp.html) | AMS authentication, Supergateway workers, stdio adapters and the protected Knowledge tool path |

## Reading the maps

The maps describe the default full stack in this repository at `bd6782f3dbaa81877d05e19cac56e7e5e69c9834`. They describe code and generated configuration, not a live installation. Services can be deselected and host ports can change when setup chooses an available port.

1. **Agent inference:** the agent uses MemoryProxy as its model API. MemoryProxy gets context from Core, forwards inference to CLIProxyAPI and records conversation data in Core. CLIProxyAPI handles the upstream account; it does not own memory storage. The current AMS login menu offers ChatGPT (Codex) and Claude.
2. **Internal processing:** Core and Knowledge use the configured `LLM_BASE_URL` and `LLM_API_KEY`, with separate `MEMORY_LLM_MODEL` and `KNOWLEDGE_LLM_MODEL` selections. This is independent of the agent's inference provider.
3. **Knowledge tools:** the agent separately connects to `/mcp` using its memory-user API key. AMS validates the user and service pairing. A private Supergateway worker translates HTTP MCP to stdio; the AMS adapter exposes `list_knowledge_tools` and `call_knowledge_tool`. Both require an explicit `knowledge_id` from Panel.
4. **Authorization:** the access gateway verifies the user, resource ACL and active team membership in Core. It then forwards the call through `knowledge-service` to Knowledge. The adapter carries the user key; internal service requests use the service key. Supergateway workers are pooled by user and credential, while adapter child processes belong to individual MCP sessions. A full MCP-container restart discards all of them.
5. **Management and storage:** Panel manages Core and calls Knowledge through `knowledge-service`; Knowledge posts processing-status callbacks to Panel. These auxiliary management paths are summarized rather than all drawn in the overview. Each stateful service has its own data directory. MCP has no persistent data volume.

## Local and remote access

| Interface | Default host address | Client credential |
| --- | --- | --- |
| MemoryProxy | `127.0.0.1:8096` | Memory-user API key; copy the agent-specific Base URL from Panel |
| Panel | `127.0.0.1:8123` | Administrator key for administration |
| MCP | `127.0.0.1:8425/mcp` | Memory-user API key |

Only these interfaces are published by default, and only on loopback. Core, CLIProxyAPI and Knowledge service interfaces remain internal unless enabled through `.env`. For another computer, configure your own Caddy reverse proxy to the chosen host ports and preserve request paths. Caddy is operator-managed and is outside the generated Compose stack.

## Source evidence

| Contract | Repository source |
| --- | --- |
| Local upstreams, helper selection and published interfaces | [deployment/model.ts](../../src/deployment/model.ts) |
| Generated service settings, model selections and data paths | [config/services.ts](../../src/config/services.ts) |
| Compose mounts and loopback port bindings | [runtime/render-compose.ts](../../src/runtime/render-compose.ts) |
| Account login choices | [config/providers.ts](../../src/config/providers.ts) |
| HTTP MCP authentication, session ownership and recovery | [runtime/mcp-gateway.ts](../../src/runtime/mcp-gateway.ts) |
| Private worker creation and lifetime | [runtime/mcp-workers.ts](../../src/runtime/mcp-workers.ts), [loopback patch](../../deploy/locks/mcp/bind-loopback.mjs) |
| MCP tool contract and HTTP forwarding | [runtime/mcp-adapter.ts](../../src/runtime/mcp-adapter.ts) |
| User status, resource access and internal service boundary | [runtime/user-auth.ts](../../src/runtime/user-auth.ts), [runtime/access-gateway.ts](../../src/runtime/access-gateway.ts), [runtime/knowledge-service.ts](../../src/runtime/knowledge-service.ts) |

## Reproducible artifacts

The editable specifications are [stack.json](stack.json) and [mcp.json](mcp.json). Delivery receipts bind their exact SHA-256 hashes to the resulting HTML: [stack receipt](stack.delivery.json), [MCP receipt](mcp.delivery.json). Browser measurement receipts and screenshots sit beside each HTML; the [visual-review record](visual-review.json) reports the manual inspection result.

Generated with Archify 2.16, diagram type `architecture`, quality profile `showcase`. No application code, installation configuration or upstream sources were changed to create these diagrams.
