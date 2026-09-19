# Agent Memory Stack architecture

Explore the [stack map](stack.html) for agent and model traffic, and the [MCP map](mcp.html) for the HTTP-to-stdio bridge. The MCP map shows the stateless request lifecycle; [source provenance](source-provenance.json) records the reviewed implementation. The stack map focuses on agent traffic; its cards describe the direct Panel–Knowledge connection and configuration lifecycle.

1. MemoryProxy, Core, Knowledge and Panel run unchanged TDAI code. CLIProxyAPI supplies model access. Configure writes native overrides; Apply applies saved files.
2. Panel connects directly to Knowledge; Knowledge sends native callbacks to Panel. All six applications share Compose, with config/bootstrap/access helpers.
3. The agent connects to AMS `/mcp` with a user key. The HTTP gateway authenticates every request and connects the SDK HTTP and stdio transports directly, isolating every authenticated POST in its own stock process.
4. Each POST runs the stock TDAI stdio MCP artifact and closes it when the response completes, aborts or fails. Tool names, schemas and results originate upstream. The internal access bridge checks resource permissions and adds the service identity header while preserving the user key before forwarding stock tool requests to Knowledge.
5. Native service defects remain visible. Container health does not establish successful model authentication, memory capture or Wiki processing.

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
| Local upstreams, required helpers and published interfaces | [deployment/model.ts](../../src/deployment/model.ts) |
| Effective model source and credential | [config/internal-llm.ts](../../src/config/internal-llm.ts) |
| Initial overrides, model selections and service endpoints | [config/native-services.ts](../../src/config/native-services.ts) |
| Compose mounts and loopback port bindings | [runtime/render-compose.ts](../../src/runtime/render-compose.ts) |
| Source-aware Configure and applying saved model settings | [setup/questions.ts](../../src/setup/questions.ts), [setup/server.ts](../../src/setup/server.ts) |
| Account login choices | [config/providers.ts](../../src/config/providers.ts) |
| HTTP MCP authentication and per-request SDK/stdio lifetime | [runtime/mcp-gateway.ts](../../src/runtime/mcp-gateway.ts) |
| Stock MCP execution and external forwarding | [runtime/mcp-gateway.ts](../../src/runtime/mcp-gateway.ts), [runtime/access-gateway.ts](../../src/runtime/access-gateway.ts) |
| Active user, team membership and resource permissions | [runtime/user-auth.ts](../../src/runtime/user-auth.ts), [runtime/access-gateway.ts](../../src/runtime/access-gateway.ts) |
| Upstream template extraction and flat defaults/overrides | [config/native-templates.ts](../../src/config/native-templates.ts), [config/native-state.ts](../../src/config/native-state.ts) |
| Unchanged upstream builds and stock stdio artifact | [deploy/node.Dockerfile](../../deploy/node.Dockerfile) |

## Reproducible artifacts

The editable specifications are [stack.json](stack.json) and [mcp.json](mcp.json). Delivery receipts bind their exact SHA-256 hashes to the resulting HTML: [stack receipt](stack.delivery.json), [MCP receipt](mcp.delivery.json). Browser measurement receipts and screenshots sit beside each HTML; the [visual-review record](visual-review.json) reports the manual inspection result.

Maps were generated with Archify 2.16. Both pass all nine showcase checks with zero errors or warnings. Browser containment passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320; dark and light screenshots were visually inspected. The overview PNG is an unmodified screenshot of the delivered stack map. These checks cover documentation rendering; see [validation](../../VALIDATION.md) for application and container evidence.
