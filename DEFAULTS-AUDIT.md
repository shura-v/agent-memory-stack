# Native defaults and AMS overrides

The selected verified TDAI source archive is the authority for service defaults. Configure copies five originals directly into `~/.config/agent-memory-stack/defaults/` and writes known installation values to `overrides/`. Updates replace defaults and preserve override bytes. See [native configuration](docs/native-configs.md).

## Initial AMS configuration

| Area | Initial override | Owner after setup |
| --- | --- | --- |
| Networking and storage | Local Compose endpoints, instance `ams`, container ports and `/data` paths | Native overrides; host publication and DATA_DIR in runtime `.env` |
| Core and Knowledge models | Local CLIProxyAPI or selected external API, independent model names | Native Core YAML and Knowledge `.env` |
| Credentials | Core service key and independently generated Proxy `admin.apiKey` | Native overrides; CLIProxyAPI service key in runtime `.env` |
| Panel connections | Native Core registry, direct Knowledge URL, native callback URL | Native registry and service `.env` files |
| Standalone preferences | SQLite Proxy storage, disabled Redis/telemetry, zero configured rate limits, empty credit-report URL | Native Proxy behavior decides their effect |

Token limits, timeouts and untouched settings inherit the selected originals. Configure changes only its explicitly collected fields; Apply reads saved files without model discovery, semantic validation or reseeding removed values. A native custom API prefix does not rewrite AMS helper routes.

## Upstream boundary

TDAI source, manifests and supplied locks are unchanged. AMS supplies no source patches, injected loaders, callback identities, prompt rewrites or session/cancellation corrections. TDAI runs on Node 22; AMS tooling uses Node 24. Core and Knowledge currently supply no npm lock, so stock dependency ranges can resolve differently when rebuilt.

MemoryProxy administration uses its native `admin.apiKey`. The pinned Proxy user-verification client omits the service Bearer expected by Core with `server.apiKey` set; AMS preserves both the configured key and that upstream result. Native callbacks and request authentication retain upstream behavior.

The separate AMS HTTP MCP gateway runs stock stdio tools and owns its caller/session isolation. Its internal access boundary supplies the service header and checks user/team/resource permissions through stock APIs. These checks do not change native TDAI handlers.

Current implementation evidence and its limits are in [validation](VALIDATION.md). Earlier audits of generated configs and source patches are superseded by this contract.
