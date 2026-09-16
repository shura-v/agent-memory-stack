## Why

Agents need a Knowledge MCP endpoint that runs entirely with the stack, on a workstation or VPS, without installing a local stdio adapter. Supergateway supplies the transport bridge, while AMS must preserve each memory user's Knowledge permissions across that bridge.

## What Changes

- Add a server-side MCP service to fresh full-stack defaults using pinned Supergateway and an adapted Knowledge stdio bridge in the same Compose deployment.
- Publish Streamable HTTP at `/mcp` through an automatically resolved host port bound to `127.0.0.1`; operators retain control of Caddy and remote exposure.
- Authenticate requests with memory-user API keys and preserve request/session identity through the bridge and the existing protected Knowledge tools gateway.
- Preserve explicit existing topology and advanced `.env` overrides; persist enabled state and the resolved MCP port for the separately planned `print-agent-connection-info` output; preserve current service selection and local/remote dependency choices.
- Keep the protected Knowledge tools gateway internal for local MCP; require explicit `.env` configuration for advanced remote dependencies, with no topology, port, or address questions.
- Limit this stage's acceptance to building required images and starting containers. Comprehensive functional verification follows Supergateway and the remaining integration work.

## Capabilities

### New Capabilities

- `server-mcp-gateway`: Containerized Streamable HTTP access to Knowledge with isolated caller identity and existing Knowledge authorization.

### Modified Capabilities

- `deployment-composition`: Include MCP in fresh full-stack defaults while preserving existing explicit service selections, automatic port allocation, dependency resolution, and one Compose project per installation.

## Impact

Expected implementation areas: deployment model, settings/questions, generated Compose, image build/lock metadata, runtime application, the protected Knowledge gateway integration, and an AMS-compatible MCP stdio adapter. A new pinned Supergateway dependency/image will be needed. Agent installation and connection-information rendering belong to the separate change; no agent configuration is written here.
