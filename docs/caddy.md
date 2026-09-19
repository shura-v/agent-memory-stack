# 🌐 Publish the stack through Caddy

Run **Caddy on the same VPS host as AMS**. Containers keep their loopback bindings; Caddy provides HTTPS on separate domains.

| Public service | Example domain | Host upstream |
| --- | --- | --- |
| MemoryProxy | `memory-proxy.my-domain.tld` | `127.0.0.1:8096` |
| Panel | `panel.my-domain.tld` | `127.0.0.1:8123` |
| Knowledge MCP | `knowledge.my-domain.tld` | `127.0.0.1:8425`, path `/mcp` |

These ports are preferences. Use the actual values shown by `ams` → **Show connection details** after apply. The `knowledge` domain points to **MCP**, which checks the caller's memory-user key and resource permissions.

## 1. Choose what to expose

AMS defaults to these settings in `~/.agent-memory-stack/.env`:

```dotenv
CORE_SERVICE_ENABLED="false"
CLIPROXY_SERVICE_ENABLED="false"
KNOWLEDGE_SERVICE_ENABLED="false"
KNOWLEDGE_TOOLS_PUBLIC_ENABLED="false"
```

Core, CLIProxyAPI, and the direct Knowledge interfaces communicate inside Compose. Panel, MemoryProxy, and MCP bind to **`127.0.0.1`** by default. You choose which services to publish through Caddy and configure your host/VPS firewall yourself; AMS does not change it. This example publishes all three sites on Caddy's TCP ports **80 and 443**. UDP 443 is optional for HTTP/3. Omit a site block to leave that service accessible only locally or through your own tunnel.

**Knowledge via MCP:** connect the agent to MCP separately to use Wiki and CodeGraph tools. MemoryProxy alone does not register MCP. `KNOWLEDGE_TOOLS_PUBLIC_ENABLED="false"` keeps the separate HTTP tool gateway private; native TDAI prompt injection remains unchanged. Memory and skill bridge instructions use the MemoryProxy domain. For the optional direct Knowledge HTTP mode and its native public URL, see [Setup and operations](operations.md#published-interfaces-and-native-connections).

The example assumes a host-installed Caddy service. Inside a separate container, `127.0.0.1` refers to that container, so these upstream addresses require your own network arrangement. AMS generates loopback host bindings; you own external forwarding and firewall rules.

## 2. Set public origins

Point the three domains' DNS records at your VPS. If you publish an AAAA record, the VPS must also be reachable over IPv6. Caddy uses the domains to obtain and renew certificates; see [Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Set the Panel origin in `~/.agent-memory-stack/.env`:

```dotenv
PANEL_PUBLIC_URL="https://panel.my-domain.tld"
```

Set MemoryProxy's public origin in the saved native root, normally `~/.config/agent-memory-stack/overrides/proxy.yaml`. Merge this field with the existing override contents:

```yaml
injection:
  externalGatewayUrl: https://memory-proxy.my-domain.tld
```

In `overrides/panel-instances.json`, update the existing `ams` instance's `proxy_endpoint` to `https://memory-proxy.my-domain.tld`. Preserve the rest of that instance and the array: native arrays replace defaults as a whole. These two fields keep Proxy's advertised URLs and Panel's agent endpoints aligned. Use origins without endpoint paths; the agent-specific path is added separately.

Then apply:

```sh
ams apply
```

From a source checkout, use `npm run dev -- apply`. There is no MCP public-origin setting: agents receive the chosen HTTPS MCP URL directly. The default MCP setup needs no public Knowledge HTTP base URL. Public origins affect advertised URLs; they do not change the loopback bindings. Apply preserves native overrides, so putting `MEMORY_PROXY_PUBLIC_URL` in runtime `.env` does not update these native fields.

## 3. Add the Caddy sites

Merge these blocks into your Caddyfile, replacing the domains and allocated ports. Keep any existing unrelated sites.

```caddyfile
memory-proxy.my-domain.tld {
	reverse_proxy 127.0.0.1:8096 {
		flush_interval -1
	}
}

panel.my-domain.tld {
	reverse_proxy 127.0.0.1:8123
}

knowledge.my-domain.tld {
	reverse_proxy 127.0.0.1:8425 {
		flush_interval -1
	}
}
```

These sites forward the entire service, preserving request paths and query strings. AMS does not add a MemoryProxy route allowlist; native upstream handlers decide which endpoints exist. TDAI applies its native authentication behavior; the separate AMS MCP endpoint enforces its own caller and resource checks. MCP clients use `/mcp` on the Knowledge MCP domain.

Publishing a service also makes its diagnostic and administrative routes reachable through that domain, subject to application authentication. Closing a port affects the whole service; it cannot distinguish routes on that port. If you want route restrictions, add your own Caddy rules. AMS does not install them.

Keep the original `Host`, `Authorization`, `x-api-key`, session, and protocol headers. Do not strip endpoint prefixes or inject backend service credentials. Streaming uses `flush_interval -1`. See [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## 4. Validate and reload

For a host installation using `/etc/caddy/Caddyfile` and systemd:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

After validation succeeds:

```sh
sudo systemctl reload caddy
```

This reloads Caddy without recreating the stack. See [Caddy validation](https://caddyserver.com/docs/command-line#caddy-validate). If AMS reallocates a port on a later apply, update its Caddy upstream and reload again.

## 5. Check from another computer

Confirm the backend bindings on the VPS with `docker ps` or `podman ps`. With the default bindings, published AMS ports read `127.0.0.1:<port>`. A binding to `0.0.0.0:<port>` or `[::]:<port>` also listens on external interfaces; whether it is reachable depends on your network and firewall. An internal container port such as `8420/tcp` without a host mapping is not a published host port.

From another computer, check these URLs **without credentials**:

```sh
curl -i -X POST https://memory-proxy.my-domain.tld/codex/ams/v1/responses \
  -H 'Content-Type: application/json' --data '{}'
curl -i -X POST https://knowledge.my-domain.tld/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' --data '{}'
```

Expected: **401** for both requests. Open the Panel domain in a browser and verify it requires login before showing private data. Also check the VPS's public IP directly on the actual backend ports: a connection should fail. These HTTP checks verify the public boundary; they do not prove model inference or memory behavior.

Use these addresses in your [agent profiles](agent-profiles/README.md):

| Connection | URL | Credential |
| --- | --- | --- |
| Codex | `https://memory-proxy.my-domain.tld/codex/ams/v1` | Memory-user key |
| Claude Code | `https://memory-proxy.my-domain.tld/claude-code/ams` | Memory-user key |
| Hermes | `https://memory-proxy.my-domain.tld/hermes/ams/v1` | Memory-user key, plus the profile's identity headers |
| Knowledge MCP | `https://knowledge.my-domain.tld/mcp` | Memory-user Bearer key |
| Panel | `https://panel.my-domain.tld` | Panel login key |

Return to [Setup and operations](operations.md) for stack management.
