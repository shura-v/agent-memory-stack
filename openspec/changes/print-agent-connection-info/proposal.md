> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## Why

Operators need a short explanation of the two independent agent connections: MemoryProxy for model requests with memory and MCP for Knowledge tools. The removed implementation printed JSON profiles and duplicated endpoint routing already shown in Panel.

## What Changes

- Add an information-only **Show connection details** menu action after **Configure stack** and **Apply configuration**, keeping Configure stack selected initially and waiting for an explicit selection.
- Group the English output by service so its address, port, and matching credentials appear together, substituting configured values and reporting unavailable services truthfully.
- Direct users to Panel for their agent’s existing Base URL; explain localhost and Caddy without generating routes, profiles, or agent configuration. Display every configured secret/key field from `.env` and every active, unexpired Core user key, including administrator keys, only in this explicitly opened screen. Use read-only local Core access once per screen without a key-selection prompt; repeat matching user keys in MemoryProxy and MCP blocks.
- Consume the implemented MCP service selection and saved port metadata.
- End successful Apply and TDAI update with a recommendation to run `ams` and choose Show connection details; keep automatic operation output free of connection-detail credentials.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `stack-delivery`: Explicit three-action menu and concise, read-only agent connection information.

## Impact

CLI menu dispatch, a dedicated connection-information presenter, remembered installation configuration, and README. No new transport or runtime service, agent installation, credential generation, or container lifecycle changes. A captured read-only exec on the running local Core enumerates existing active key metadata and rechecks each key before reading its value without writing files or service logs. A failed key read does not prevent displaying the remaining keys, and unavailable Core does not hide configured `.env` secrets. The existing build-and-container-start acceptance boundary remains; comprehensive integration validation is deferred until Supergateway and the remaining integration work are complete.
