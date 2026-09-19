> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## Why

Core and Knowledge can already call the local CLIProxyAPI through explicit API settings, but setup presents internal processing as a separate external provider and asks for models before local account authorization. Make the shared-provider path an explicit default for fresh full-stack installations and explain both supported routes in documentation and diagrams.

## What Changes

- Ask for the CLIProxyAPI account provider before `Models for memory and Knowledge`, with `Use this stack's CLIProxyAPI` selected for new installations containing local CLIProxyAPI, and `Connect another model API` as the alternative. Preserve existing provider choices.
- Derive the local API address and credential from CLIProxyAPI without endpoint or key prompts. Keep separate Core and Knowledge model selections.
- Save local mode without requiring a running engine or model names. During apply, authorize CLIProxyAPI and discover/select missing models before starting or recreating internal model consumers. Resume interrupted work without repeating completed questions.
- Use `~/.agent-memory-stack` for configuration, apply, update, and connection details without a directory question, public directory flag, XDG override, or target-pointer file. Manage `DATA_DIR` through `.env` only: default to `./data` relative to that folder and preserve any saved value exactly. Existing installations elsewhere are not automatically migrated or deleted. Retain the external-provider workflow, current service-key/OAuth ownership, private networking, existing-stack guard, and applied-configuration recovery boundaries.
- Update README, operations guidance, the interactive architecture specifications and HTML, their delivery evidence, and the overview image used by README and GitHub Pages. Show shared CLIProxyAPI and separate external API routes, while keeping MemoryProxy and MCP distinct.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-deployment`: configurable internal model source, source-aware questions, independent model selection with a shared proxy, and provider-first initialization.
- `deployment-composition`: deferred model selection, resumable apply, local dependency ordering and preservation of existing deployment choices.
- `stack-delivery`: source-aware provider input, the narrow first-apply completion exception, and documentation consistent with the supported routing modes.

## Impact

Primary areas are `src/config/settings.ts`, `src/config/services.ts`, `src/deployment/model.ts`, setup questions/application/model discovery, and runtime Compose/provider operations. Existing tests for configuration, setup, navigation, apply and snapshots need focused updates. Documentation targets are `README.md`, `docs/operations.md`, `docs/architecture/`, `docs/images/agent-memory-stack-overview.png`, and the Pages landing text where applicable.

No new inference proxy, provider integration, public listener, agent configuration, npm publication or Pages deployment is introduced. Model requests use existing CLIProxyAPI protocol support. Diagram changes document routing choices, not a new MCP data path.
