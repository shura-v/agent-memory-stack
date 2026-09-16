## Context

See proposal.md for motivation. The current CLI has explicit Configure stack and Apply configuration menu items in `src/cli/run.ts`; `src/cli/commands.ts` retains `ams apply`. Remembered installation paths and environment parsing already exist. The previous connection-information implementation has been removed. The server has no MCP transport today.

## Goals / Non-Goals

**Goals:** Keep the action a small read-only presenter of saved connection settings. Explain the two independent connections in plain English and reuse Panel as the authoritative source for agent-specific URLs and user keys.

**Non-Goals:** Agent configuration files, JSON profiles, installation commands, new MemoryProxy routes, credential lookup or recovery, container control, and network reachability probes. MCP deployment belongs to `add-server-mcp-gateway`.

## Decisions

### Explicit menu

Add Connect an agent after Configure stack and Apply configuration; keep Configure stack selected initially. Explicit selection remains mandatory before any action. Apply configuration and standalone `ams apply` share the existing saved-target application workflow, also available through the setup apply prompt. The existing-stack guard belongs only to Configure stack and does not block Apply configuration or Connect an agent. Automatically starting setup would remove the requested navigation point.

### Exact agreed output

Preserve this reference text word for word, including punctuation and paragraph breaks. The chat bullet and indentation are presentation framing, not content. The numeric MemoryProxy port is the example value; production rendering substitutes its configured host port. MCP_PORT is deliberately unresolved in this example.

```text
Connect an agent

MemoryProxy — API for your agent with memory
Port: 8096

Copy your agent’s Base URL and API key from:
Panel → API Keys → Client Access Endpoint


MCP — Knowledge tools for your agent
Port: <MCP_PORT>
Transport: Streamable HTTP
Path: /mcp

Connect your agent to this MCP server to search Wiki and code resources.
Authenticate with your memory-user API key.


Local or remote?

On this machine:
Use http://localhost:<port>.

On another computer:
Proxy each port through Caddy and use your HTTPS domains.
Preserve the request paths.

Configure MemoryProxy, MCP, or both.
```

The accompanying placeholder explanation means: `<MCP_PORT>` is a placeholder; MCP has not yet been added to Compose. This explanation is planning context, not a claim that the endpoint exists. Project/UI wording remains English.

### Saved settings and availability

Read the remembered installation and parse its `.env` using existing configuration facilities. Render configured host ports only for selected local services. `simplify-stack-setup` saves the engine-resolved ports in the existing port fields during apply; use those saved values, never hard-coded defaults. Its `.ams/network.json` tracks generated local origins for reconfiguration, not another authority for connection ports. Never infer host ports from container-only or remote service addresses. For a remote or disabled service, replace its local Port line with a short status directing the operator to that service host; retain the agreed purpose and connection guidance where applicable. For missing or invalid saved settings, provide a short Configure stack instruction without entering setup.

Use the MCP service selection and host port contract established by `add-server-mcp-gateway`. Until that change is implemented and configured, show `MCP is not configured.` alongside the reference MCP guidance; do not print a fictitious listening port or describe the placeholder as a usable address. Once configured, replace MCP_PORT with its actual saved host port. Describe these as saved settings, not a live health check, in one short line outside the agreed text.

### Plain text and credential boundaries

Use a small presenter and the existing interaction boundary. Avoid terminal decoration that changes or wraps copyable content unnecessarily. Do not construct Codex/Claude endpoint paths: Panel already owns those paths. Do not expose provider, Core-service, or CLIProxyAPI secrets; the output points to Panel for the intended memory-user key. A JSON profile or generated client command would introduce client-specific configuration outside this action's scope.

## Risks / Trade-offs

- Saved configuration can differ from running services → label it as saved settings and leave lifecycle operations to apply.
- MCP arrives in a separate change → show explicit unavailable status until its metadata exists; never imply that Supergateway is already deployed.
- Panel endpoint compatibility and actual memory behavior remain separate runtime concerns → preserve native endpoint guidance; comprehensive agent and memory validation remains deferred.

## Migration Plan

Implement the presenter and menu dispatch without migrating saved installations. Existing environment files and target paths remain valid. Add concise README instructions with the approved example. Rolling back removes only the menu action and presenter; data and external agent settings are unaffected.

The current acceptance boundary remains images built and selected containers started. This planning change adds no functional acceptance checklist; comprehensive validation follows Supergateway and the remaining integrations.
