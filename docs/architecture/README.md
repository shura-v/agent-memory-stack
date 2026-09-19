# Agent Memory Stack architecture

Open the standalone HTML files in a browser. Each includes light/dark themes, zoom, component inspection and export controls; no server is required.

| Diagram | What it explains |
| --- | --- |
| [Stack overview](stack.html) | Agent inference, memory, internal LLM processing, Knowledge tools and Panel |
| [Inside the MCP bridge](mcp.html) | AMS authentication, Supergateway workers, stdio adapters and the protected Knowledge tool path |

## Reading the maps

The maps describe the working-tree implementation of `use-cliproxy-for-internal-models`, including the shared default and external alternative. They describe configuration and routing, not a live installation or behavior guaranteed by the current Git commit. The [source provenance record](source-provenance.json) records the base commit and hashes of the reviewed working-tree source files; relative anchors below remain the source references. The HTML omits commit-pinned source links because this change was uncommitted when rendered. Services can be deselected and host ports can change when setup chooses an available port.

1. **Agent inference:** the agent uses MemoryProxy as its model API. MemoryProxy gets context from Core, forwards inference to CLIProxyAPI and records conversation data in Core. CLIProxyAPI handles the upstream account; it does not own memory storage. The current AMS login menu offers ChatGPT (Codex) and Claude.
2. **Internal processing:** fresh full stacks use `INTERNAL_LLM_SOURCE=cliproxy`, deriving the internal Compose URL and current CLIProxyAPI service key. The diagram's source-choice node is configuration, not another service: exactly one branch applies. `external` uses the separate `LLM_BASE_URL`/`LLM_API_KEY`. Core and Knowledge keep independent model IDs; the agent selects its own model. Shared accounts also share capacity. Existing configurations without this field retain external routing.
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
| Effective model source and credential | [config/internal-llm.ts](../../src/config/internal-llm.ts) |
| Generated service settings, model selections and data paths | [config/services.ts](../../src/config/services.ts) |
| Compose mounts and loopback port bindings | [runtime/render-compose.ts](../../src/runtime/render-compose.ts) |
| Source-aware setup and deferred model selection | [setup/questions.ts](../../src/setup/questions.ts), [setup/server.ts](../../src/setup/server.ts) |
| Account login choices | [config/providers.ts](../../src/config/providers.ts) |
| HTTP MCP authentication, session ownership and recovery | [runtime/mcp-gateway.ts](../../src/runtime/mcp-gateway.ts) |
| Private worker creation and lifetime | [runtime/mcp-workers.ts](../../src/runtime/mcp-workers.ts), [loopback patch](../../deploy/locks/mcp/bind-loopback.mjs) |
| MCP tool contract and HTTP forwarding | [runtime/mcp-adapter.ts](../../src/runtime/mcp-adapter.ts) |
| User status, resource access and internal service boundary | [runtime/user-auth.ts](../../src/runtime/user-auth.ts), [runtime/access-gateway.ts](../../src/runtime/access-gateway.ts), [runtime/knowledge-service.ts](../../src/runtime/knowledge-service.ts) |

## Reproducible artifacts

The editable specifications are [stack.json](stack.json) and [mcp.json](mcp.json). Delivery receipts bind their exact SHA-256 hashes to the resulting HTML: [stack receipt](stack.delivery.json), [MCP receipt](mcp.delivery.json). Browser measurement receipts and screenshots sit beside each HTML; the [visual-review record](visual-review.json) reports the manual inspection result.

Generated with Archify 2.16, diagram type `architecture`, quality profile `showcase`. These artifacts document the concurrent application change. Diagram generation itself did not run application tests, mutate an installation, or verify inference. Shared-mode setup can save missing model choices; apply authorizes CLIProxyAPI and completes them before starting internal consumers. The MCP authentication/session/tool path is unchanged by model-source selection.
