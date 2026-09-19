## Why

AMS currently couples TDAI updates to local source patches, copied dependency manifests, injected loaders and a private service-identity protocol. The operator requires a simpler invariant: use the selected TDAI revision unchanged, including its bugs, and connect it through its native configuration and APIs.

## What Changes

- **BREAKING:** Remove TDAI source patches, injected modules/preloads, dependency overrides and AMS repairs of upstream behavior. Use upstream dependencies and a supported runtime; report stock failures without silently fixing them.
- Fetch templates from the selected verified TDAI source. Keep native files directly in `~/.config/agent-memory-stack/defaults/` and `overrides/`; remove repository/package copies and revision-named configuration directories. Updates replace defaults and preserve overrides.
- Keep one complete local stack. Use native Panel/Knowledge connections and callbacks; remove `knowledge-service`, `/ams/identity`, pairing machinery and promises that depended on patched TDAI. Preserve normal container readiness, bootstrap through stock APIs and recovery of configuration files.
- **BREAKING:** Keep the AMS HTTP MCP gateway, replace its custom two-tool implementation with stock TDAI stdio MCP. Use a narrow external bridge for the missing service header and existing AMS user/resource authorization; preserve upstream tool names, schemas and results.
- Consolidate configuration handling: Configure collects settings/models, Apply applies saved files, and configured values remain the user's responsibility. Remove duplicate generators, custom dotenv codecs, development-format migrations, obsolete tests and misleading documentation.

## Capabilities

### New Capabilities

- `stock-tdai-integration`: immutable upstream delivery, native configuration acquisition, and stock stdio MCP behind an external AMS boundary.

### Modified Capabilities

- `stack-delivery`: package only AMS-owned code and metadata; maintain flat native configuration and stock dependency ownership.
- `deployment-composition`: direct native service connections/callbacks, file application and process readiness without an injected integration protocol.
- `server-deployment`: distinguish native TDAI behavior from guarantees of the separate AMS gateway and stop promising locally repaired upstream behavior.

## Impact

Touches build/source acquisition and Docker recipes, native configuration lifecycle and transport, Compose/readiness, MCP workers/bridge, tests and operator docs. The six applications remain; helpers reduce to `config`, `bootstrap` and `access`, with no additional publicly published backend.

This change supersedes conflicting decisions in the unfinished `preserve-native-tdai-configs` change and the custom tool contract in `add-server-mcp-gateway`. It retains two visible configuration sets, user-owned values, Configure-only models and the fixed full stack. There have been no releases: no migrations or compatibility shims are required. Existing partial working-tree edits are inputs to review, not evidence of completion. This proposal does not deploy, commit, synchronize or archive changes.
