> The credential-pool and persistent-session lifecycle below is historical. The current request-scoped stateless contract is defined in [the stock integration change](../simplify-stock-tdai-integration/) and [the MCP specification](../../specs/server-mcp-gateway/spec.md).

> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## 1. Deployment configuration

- [x] 1.1 Add MCP to fresh full-stack defaults and `MCP_PORT` to shared automatic allocation, preserving existing explicit selections; deliver the resolver and saved enabled/resolved-port metadata contract without service, address, port, or interface prompts.
- [x] 1.2 Resolve MCP's local or explicitly configured remote Core and protected Knowledge dependencies from .env without enabling unrequested services in existing installations; deliver internal local gateway routing and generated configuration that distinguishes protected tools from raw service routes.

## 2. Caller identity and Knowledge bridge

- [x] 2.1 Implement the AMS MCP request boundary using existing Core-backed memory-user verification and isolated Supergateway/stdio workers per credential context; deliver session-to-caller binding, request authentication, bounded worker lifecycle, and secret-safe shutdown/logging.
- [x] 2.2 Adapt the packaged Knowledge stdio interface to resource-scoped tool listing/calling through `/v3/tools/list` and `/v3/tools/call`; deliver explicit `knowledge_id` schemas and forwarding of the caller's Bearer key plus service-instance header.

## 3. Container delivery

- [x] 3.1 Pin the selected Supergateway version and package the identity boundary, gateway workers, and adapter in buildable images; deliver image definitions and lock/build metadata integrated with automatic image preparation.
- [x] 3.2 Add MCP containers to generated Compose and application lifecycle, publishing only the authenticated listener on `127.0.0.1` at the automatically resolved and persisted port; deliver startup ordering, saved configuration, and deselection behavior that preserves Core/Knowledge data.
- [x] 3.3 Document local access and operator-managed Caddy forwarding with `/mcp` preserved, plus the saved metadata consumed by `print-agent-connection-info`; deliver English documentation without installing or configuring any agent.

## 4. Acceptance

- [x] 4.1 Build the required images and start the selected containers; record image identities, engine, platform, long-running services still running at the observation point, and successful required initialization jobs. This is the only acceptance check for this stage. Comprehensive MCP, authorization-isolation, agent, provider, memory/Wiki, and recovery verification follows Supergateway and the remaining integration work.
