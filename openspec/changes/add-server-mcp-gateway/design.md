## Context

See `proposal.md` for motivation. Current deployment selection is centralized in `src/deployment/model.ts`; required images, interfaces, and startup ordering are derived from it. Knowledge already has a protected user-facing gateway distinct from its raw service API.

Observed compatibility gaps:

- Upstream `MemoryKnowledge/src/mcp/server.ts` starts a stdio server with one `KNOWLEDGE_API_TOKEN` for its lifetime. Its `http-client.ts` calls `/v3/wiki/*` and `/v3/code-graph/*`, without the AMS service-instance header.
- `src/runtime/access-gateway.ts` accepts only `/v3/tools/list` and `/v3/tools/call`. It requires a Bearer memory-user key, `x-tdai-service-id`, and `knowledge_id`, then checks active user, asset, ACL, and team membership before forwarding to raw Knowledge.
- [Supergateway documents stdio to Streamable HTTP](https://github.com/supercorp-ai/supergateway#stdio--streamable-http), with configurable `/mcp` and stateful sessions. Its documented outbound header flags do not establish inbound per-user authentication or HTTP identity propagation into a shared stdio process.

Wrapping the unmodified upstream adapter therefore does not satisfy the AMS contract.

## Goals / Non-Goals

**Goals:** Reuse Supergateway's MCP transport, adapt the Knowledge tool contract, and preserve caller identity with the existing authorization decisions. Package the whole path in the server deployment with a loopback host port.

**Non-Goals:** Installing/configuring an agent, printing connection guidance, managing Caddy, changing memory inference routing, exposing raw Knowledge management APIs, or certifying complete agent/provider/memory behavior. Connection guidance belongs to `print-agent-connection-info`.

## Decisions

### 1. Fresh full-stack MCP with configured dependencies

Add `mcp` to the complete fresh-install service defaults once implemented. Preserve existing explicit `AMS_SERVICES` values, including installations without MCP; advanced operators enable or disable it by editing `.env`. Configure stack displays the resulting topology and asks no service-selection, placement, stack-address, port, or interface questions. This follows `simplify-stack-setup` and supersedes the earlier MCP checkbox and port-prompt design.

The resolver adds only necessary support services and requires Core for user authentication and a protected Knowledge tools endpoint, each local or explicitly remote. Local MCP connects to the internal protected Knowledge gateway over Compose without publishing Knowledge HTTP to the host. Remote dependencies use `REMOTE_CORE_URL`, `REMOTE_CORE_API_KEY`, and `REMOTE_KNOWLEDGE_TOOLS_URL`; a remote protected Knowledge tools interface is distinct from the private Panel/service endpoint. Core and Knowledge must belong to the same configured service instance. The protected tools gateway exposes service-authenticated `/ams/identity` metadata containing its verified Core/Knowledge pair, reused by preflight and the MCP request boundary. Existing Core initialization rules apply only when Core is configured locally. Missing advanced configuration produces named `.env` guidance.

Use the shared runtime-aware allocator for `MCP_PORT`: prefer a saved/default value, select an available alternative on a confirmed binding conflict, persist the result, and report the actual port. Save-only configuration requires no port probe or engine. The MCP default is `8425`, separate from Core (`8420`), Knowledge tools (`8422`), Knowledge service (`8423`), Panel (`8123`), and MemoryProxy (`8096`). The only default host entry points are Panel, MemoryProxy, and MCP; other interfaces require explicit `.env` opt-in.

The saved service selection and resolved `MCP_PORT` are the metadata contract for the separate information change. That consumer needs no stored MCP user key, fabricated domain, or client JSON profile. Preserve the approved Connect an agent text and supply its actual saved ports.

### 2. Authenticate before routing; isolate the stdio identity

Use an AMS HTTP identity boundary in front of internal Supergateway workers. Reuse the existing Core-backed user verification logic; every request, including initialization, streams, and session teardown, requires a current valid Bearer user key. Bind external MCP sessions to the authenticated identity and reject session replay under another key.

The initial implementation uses an isolated Supergateway/stdio worker per authenticated credential context. The worker receives only that caller's ephemeral key through a controlled in-memory launch context, never a global deployment token or command-line argument. Internal listeners are container-private and never published. The outer boundary routes the complete MCP HTTP exchange to the matching worker, including streaming responses and lifecycle messages. Workers have bounded count (eight credential contexts, eight sessions each), five-minute idle cleanup, and deterministic child-process-group shutdown; credentials are discarded when workers end.

This uses more processes than a shared worker, but gives the existing static-token stdio model a clear identity boundary. A single worker with one shared `KNOWLEDGE_API_TOKEN` is rejected because it would grant all callers the same identity. Do not treat Supergateway `--oauth2Bearer` as an inbound auth mechanism. Pin Supergateway `3.4.3` and MCP SDK `1.30.0` in a dedicated production lock. Supergateway has no listen-host option for its stateful transport; an exact-match build patch binds this listener to `127.0.0.1` inside the container and fails on implementation drift. A second exact-match patch starts the fixed packaged adapter directly so session teardown cannot leave a shell child running. AMS remains responsible for caller/session binding regardless of transport internals.

### 3. Adapt to the protected tools contract

Package an AMS-compatible stdio adapter alongside Supergateway. Reuse compatible MCP setup and response handling from upstream, but replace its raw endpoint mapping with protected `/v3/tools/list` and `/v3/tools/call` requests. The adapter exposes explicit resource-scoped operations: list tools for `knowledge_id`, and call a named tool with `knowledge_id` and `params`. Its schemas and descriptions make these inputs discoverable to agents.

Forward the caller's key and configured service instance to the gateway. The gateway remains the authority for asset/team permissions on each operation; MCP never substitutes Core's service key for the user key on this interface. Keep raw Knowledge access behind the existing gateway. A remote protected gateway works through the same contract as a selected local one.

This avoids inventing authorization for each upstream raw route or expanding the public gateway's API surface. Resource discovery beyond explicit Knowledge identifiers is deferred; this bridge does not add privileged resource enumeration.

### 4. One deployment, operator-owned exposure

Build one dedicated `mcp` image containing the boundary, Supergateway, and adapter within the existing Compose project. Mount generated `mcp.json` read-only; no MCP user-key file or persistent data volume is created. The boundary configuration holds the Core service credential for verification; child workers receive only the caller key, protected tools URL, and service-instance identifier. For MCP, only the AMS-authenticated `/mcp` listener is published as `127.0.0.1:${MCP_PORT}:<internal-port>`. Raw Supergateway workers have no host mapping. Clients on the same machine use localhost; remote clients use the operator's Caddy domain with `/mcp` and authorization preserved. No local agent stdio installation is required.

Extend the existing image preparation, saved configuration, snapshot, and startup mechanisms. Removing MCP from `AMS_SERVICES` removes only this installation's MCP containers and processes, preserving Knowledge/Core data. Runtime logs redact keys and session credentials.

### 5. Build-and-start acceptance only

The sole acceptance check for this stage is to build the required images and start the selected containers, recording the actual engine/platform and result. Full MCP behavior, concurrent-user isolation exercises, real agent flows, memory/Wiki semantics, and recovery checks remain deferred until Supergateway and the remaining integration work are complete. Deferring those checks does not relax the functional or authorization contracts, and startup is not evidence that they have all been validated.

## Risks / Trade-offs

- Per-credential workers consume resources → bound worker creation, expire idle workers, and terminate children on shutdown.
- Upstream transport/session behavior can drift → pin the selected version and retain the AMS request/session boundary.
- Remote Core and protected Knowledge can be mispaired → preserve explicit service-instance configuration and existing dependency checks; never bypass failed authorization.
- A container can start while tool behavior remains incomplete → report only build/start acceptance and retain the deferred functional verification boundary.

## Migration Plan

Fresh installations include MCP when this change is implemented. Existing explicit configurations retain their service selections; operators can add MCP to `AMS_SERVICES` and configure any remote dependencies in `.env`, then use the existing apply path. Apply resolves and saves its loopback port automatically. Rollback removes MCP from `AMS_SERVICES` and reapplies the preserved configuration; it does not remove Core or Knowledge data. The separate information change consumes the same saved port/enabled state when available.
