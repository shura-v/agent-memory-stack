## Why

Operators need a short explanation of the two independent agent connections: MemoryProxy for model requests with memory and MCP for Knowledge tools. The removed implementation printed JSON profiles and duplicated endpoint routing already shown in Panel.

## What Changes

- Add an information-only **Connect an agent** menu action after **Configure stack** and **Apply configuration**, keeping Configure stack selected initially and waiting for an explicit selection.
- Preserve the agreed English output verbatim in the design, substituting configured ports when available and reporting unavailable services truthfully.
- Direct users to Panel for their agent's existing Base URL and API key; explain localhost and Caddy without generating routes, profiles, or agent configuration.
- Consume MCP availability and port metadata from the separate `add-server-mcp-gateway` change. Until then, describe MCP as planned.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `stack-delivery`: Explicit three-action menu and concise, read-only agent connection information.

## Impact

CLI menu dispatch, a dedicated connection-information presenter, remembered installation configuration, and README. No new transport or runtime service; no agent installation, credential generation, network probing, or container operations. The existing build-and-container-start acceptance boundary remains; comprehensive integration validation is deferred until Supergateway and the remaining integration work are complete.
