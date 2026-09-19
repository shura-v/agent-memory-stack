> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## Context

See proposal.md for motivation. The CLI has explicit Configure stack, Apply configuration, and Show connection details menu items in `src/cli/run.ts`; `src/cli/commands.ts` retains `ams apply`. Remembered installation paths and environment parsing already exist. The connection presenter and server MCP transport are implemented; this revision groups saved addresses and matching credentials by service.

## Goals / Non-Goals

**Goals:** Keep the action a small read-only presenter of saved connection settings. Explain the two independent connections in plain English and reuse Panel as the authoritative source for agent-specific URLs. On the explicit screen, display every configured secret/key field from `.env` and every active, unexpired user key from local Core, including administrator keys, without asking the operator to select a key. Keep each address and its matching credentials together in the same service block.

**Non-Goals:** Agent configuration files, JSON profiles, installation commands, new MemoryProxy routes, credential creation or rotation, container lifecycle control, and network reachability probes. MCP deployment belongs to `add-server-mcp-gateway`.

## Decisions

### Explicit menu

Add Show connection details after Configure stack and Apply configuration; keep Configure stack selected initially. Explicit selection remains mandatory before any action. Apply configuration and standalone `ams apply` share the existing saved-target application workflow, also available through the setup apply prompt. The existing-stack guard belongs only to Configure stack and does not block Apply configuration or Show connection details. Automatically starting setup would remove the requested navigation point.

### Service blocks

Group the screen by service so the operator can copy an address and its matching credentials from one place. This layout replaces the earlier verbatim text layout while preserving its explanation of MemoryProxy, MCP, native Panel routes, and localhost/Caddy access. Project/UI wording remains English.

| Block | Address and purpose | Credentials immediately below |
| --- | --- | --- |
| Panel | Saved local URL/port and configured external URL; web interface and login | All active administrator keys, labeled for Panel login |
| MemoryProxy | Saved listener address/port; API for the agent with memory; direct the operator to Panel → API Keys → Client Access Endpoint for the native agent-specific Base URL | All active, unexpired Core user keys, with user/key labels and administrator privileges identified |
| MCP | Saved localhost URL ending in `/mcp`, port, and Streamable HTTP transport; Knowledge tools for searching Wiki and code resources | The same active Core user keys used as Bearer credentials |
| Core service | Configured authenticated service endpoint when published, otherwise internal-only status | `CORE_API_KEY`, labeled for service-to-Core access |
| CLIProxyAPI | Configured service endpoint when published, otherwise internal-only status | `CLIPROXY_API_KEY`, labeled for direct model API access |
| Internal LLM | `LLM_BASE_URL` and configured Core/Knowledge models | `LLM_API_KEY` |
| Remote Core / remote model | Corresponding saved remote address in separate blocks; explicitly identify a retained connection that is currently inactive | `REMOTE_CORE_API_KEY` / `REMOTE_MODEL_API_KEY` respectively |

Within each block, put a credential label on its own line and its complete value on the next plain, unwrapped line. Retain every configured secret field even when the associated service is inactive. An absent local listener must be described as disabled, remote, or internal-only; do not manufacture a local URL. Do not put matching credentials in a separate distant all-keys section.

Read Core key metadata once and read each full value once after checking its current status and expiry. Keep this result in memory for this screen and repeat its values in the applicable Panel, MemoryProxy, and MCP blocks; repeated presentation does not perform another database lookup or create another key.

End with concise shared connection guidance: use localhost on the service host, or proxy each published port through Caddy and use its HTTPS domain from another computer. Preserve request paths. The operator can configure MemoryProxy, MCP, or both. Do not generate agent-specific routes or agent configuration.

### Saved settings and availability

Read the remembered installation and parse its `.env` using existing configuration facilities. Render configured host ports only for selected local services. `simplify-stack-setup` saves the engine-resolved ports in the existing port fields during apply; use those saved values, never hard-coded defaults. Its `.ams/network.json` tracks generated local origins for reconfiguration, not another authority for connection ports. Never infer host ports from container-only or remote service addresses. For a remote or disabled service, replace its local Port line with a short status directing the operator to that service host; retain the service purpose and connection guidance where applicable. For missing or invalid saved settings, provide a short Configure stack instruction without entering setup.

Use the MCP service selection and host port contract established by `add-server-mcp-gateway`. When it is not configured, show `MCP is not configured.` inside its service block alongside the MCP purpose; do not print a fictitious listening port or describe the placeholder as a usable address. When configured, show its actual saved host port and `/mcp` URL. Describe these as saved settings, not a live health check, in one short line at the start of the screen.

### Completion guidance

After successful Apply, including immediate setup application and TDAI update, print: `Run ams and choose Show connection details to see connection ports and all configured keys.` This hint follows provider login and also appears when saved provider authorization is reused. Do not automatically open the screen or print its credentials in long-operation output.

### Plain text and credential boundaries

Use a small presenter and the existing interaction boundary. Avoid terminal decoration that changes or wraps copyable content unnecessarily. Do not construct Codex/Claude endpoint paths: Panel already owns those paths. The explicit screen displays every configured field marked secret in the existing `.env` schema, including provider, local service, and remote service keys. Include recognized saved secrets even when their service is currently inactive; do not invent or generate missing values. Label each value by its setting name and purpose, distinguishing service/provider credentials from agent credentials. Print each full value on one copyable unwrapped line beneath its label in the matching service block.

TDAI stores existing user keys in Core SQLite but its public API returns only key prefixes. Locate the running Core by verified Compose project/service labels and use captured engine exec with Node’s read-only SQLite access to the ams metadata database. Enumerate only active, unexpired user/key metadata once, then recheck status and expiry immediately before reading each full key once. Reuse those captured values for repeated presentation in applicable service blocks. Display all successfully read keys with their user/key metadata, identifying administrator privileges and Panel login use. There is no single-key selection prompt. If an individual key becomes unavailable, report that item and continue with the remaining keys. If Core is unavailable or remote, keep the `.env` credentials and connection guidance visible and direct the operator to Panel for user keys.

Do not generate or rotate keys, copy databases, save secrets, pass secrets in arguments, or write keys to application logs. Reveal the credentials only after the operator chooses Show connection details. The explicit display can remain in terminal scrollback or capture. A JSON profile or generated client command would introduce client-specific configuration outside this action's scope.

## Risks / Trade-offs

- Saved configuration can differ from running services → label it as saved settings and leave lifecycle operations to apply.
- Core SQLite schema can change with upstream TDAI → read-only lookup failures leave services untouched and direct the operator to Panel.
- Panel endpoint compatibility and actual memory behavior remain separate runtime concerns → preserve native endpoint guidance; comprehensive agent and memory validation remains deferred.

## Migration Plan

Implement the presenter and menu dispatch without migrating saved installations. Existing environment files and target paths remain valid. Add concise README instructions describing the service blocks and matching credentials. Rolling back removes only the menu action and presenter; data and external agent settings are unaffected.

The current acceptance boundary remains images built and selected containers started. This planning change adds no functional acceptance checklist; comprehensive validation follows Supergateway and the remaining integrations.
