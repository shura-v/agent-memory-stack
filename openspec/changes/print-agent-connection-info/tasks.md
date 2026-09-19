> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## 1. Information-only menu action

- [x] 1.1 Add Show connection details after Configure stack and Apply configuration in the explicit menu and route it to a dedicated presenter, retaining Configure stack as the initial selection and the existing apply command.
- [x] 1.2 Read the remembered installation settings and present configured host ports, with actionable missing-configuration and unavailable-service messages and no configuration writes or container lifecycle changes.
- [x] 1.3 Render the service blocks defined in design.md with each address/port and its matching credentials adjacent, consume the separate MCP change's availability metadata, and direct agent-specific Base URL lookup to Panel without JSON profiles or generated routing. Display every configured `.env` secret/key and every active, unexpired existing Core user key, including administrator keys, without a selection prompt. Read Core metadata once and each full key once, repeat the captured values only in the applicable service blocks, recheck each Core key before reading it, continue after individual failures, and retain `.env` credentials if Core is unavailable. Keep full values on copyable unwrapped lines and perform no credential writes.
- [x] 1.4 End successful Apply/update with the TUI connection-details recommendation; update README with the service grouping and explain the independent purposes of MemoryProxy and MCP, localhost access, and Caddy forwarding with paths preserved.

## 2. Build and container startup acceptance

- [x] 2.1 Record the single current-stage acceptance result: required images built and selected containers started, naming image identities, platform, runtime, running services, and successful required initialization jobs.

Comprehensive agent, MCP, authorization, memory/Wiki, and recovery validation is deferred until Supergateway and the remaining integrations are complete. It is not part of this change's acceptance checklist. The scenarios in the delta describe required product behavior, not additional current-stage verification tasks.

Historical build/start evidence: `docs/validation/connection-details-start.json` and the 2026-09-19 connection-details entry in `VALIDATION.md`. This evidence predates the expanded all-key display and its service grouping; it does not claim a new container acceptance run for these presentation revisions.
