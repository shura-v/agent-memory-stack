# Agent Memory Stack architecture

The retained HTML maps and their receipts describe an earlier development snapshot with patched integration. They are historical artifacts; use the current flow below and [native configuration](../native-configs.md) for implementation guidance.

1. MemoryProxy, Core, Knowledge and Panel run unchanged TDAI code. CLIProxyAPI supplies model access. Configure writes native overrides; Apply applies saved files.
2. Panel connects directly to Knowledge; Knowledge sends native callbacks to Panel. All six applications share Compose, with config/bootstrap/access helpers.
3. The agent connects to AMS `/mcp` with a user key. The HTTP gateway authenticates every request and isolates Supergateway workers by credential.
4. Each session runs the stock TDAI stdio MCP artifact. Tool names, schemas and results originate upstream. The internal access bridge checks resource permissions and adds the missing service header before forwarding to Knowledge.
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
| Generated service settings, model selections and data paths | [config/native-services.ts](../../src/config/native-services.ts) |
| Compose mounts and loopback port bindings | [runtime/render-compose.ts](../../src/runtime/render-compose.ts) |
| Source-aware Configure and applying saved model settings | [setup/questions.ts](../../src/setup/questions.ts), [setup/server.ts](../../src/setup/server.ts) |
| Account login choices | [config/providers.ts](../../src/config/providers.ts) |
| HTTP MCP authentication, session ownership and recovery | [runtime/mcp-gateway.ts](../../src/runtime/mcp-gateway.ts) |
| Private worker creation and lifetime | [runtime/mcp-workers.ts](../../src/runtime/mcp-workers.ts), [loopback patch](../../deploy/locks/mcp/bind-loopback.mjs) |
| Stock MCP execution and external forwarding | [runtime/mcp-workers.ts](../../src/runtime/mcp-workers.ts), [runtime/access-gateway.ts](../../src/runtime/access-gateway.ts) |
| User status, resource access and internal service boundary | [runtime/user-auth.ts](../../src/runtime/user-auth.ts), [runtime/access-gateway.ts](../../src/runtime/access-gateway.ts) |

## Reproducible artifacts

The editable specifications are [stack.json](stack.json) and [mcp.json](mcp.json). Delivery receipts bind their exact SHA-256 hashes to the resulting HTML: [stack receipt](stack.delivery.json), [MCP receipt](mcp.delivery.json). Browser measurement receipts and screenshots sit beside each HTML; the [visual-review record](visual-review.json) reports the manual inspection result.

Historical maps were generated with Archify 2.16. Their source provenance and delivery receipts apply only to that earlier snapshot, not the stock integration described above. See [validation](../../VALIDATION.md) for current evidence.
