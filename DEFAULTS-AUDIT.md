# Native defaults and AMS overrides

The selected verified TDAI source archive is the authority for service defaults. Configure copies five originals directly into `~/.config/agent-memory-stack/defaults/` and writes known installation values to `overrides/`. Updates replace defaults and preserve override bytes. See [native configuration](docs/native-configs.md).

## Initial AMS configuration

| Area | Initial override | Owner after setup |
| --- | --- | --- |
| Networking and storage | Local Compose endpoints, instance `ams`, container ports and `/data` paths | Native overrides; host publication and DATA_DIR in runtime `.env` |
| Core and Knowledge models | Local CLIProxyAPI or selected external API, independent model names | Native Core YAML and Knowledge `.env` |
| Credentials | Independently generated Proxy `admin.apiKey`; Core service authentication left to native configuration | Native overrides; CLIProxyAPI service key in runtime `.env` |
| Native Core client tokens | Proxy template `local` values retained; initial Panel instance `api_key` uses `local` when Core service key is unset | Nonempty native client fields; public values provide no service authentication |
| Panel connections | Native Core registry, direct Knowledge URL, native callback URL | Native registry and service `.env` files |
| Standalone preferences | SQLite Proxy storage, disabled Redis/telemetry, zero configured rate limits, empty credit-report URL | Native Proxy behavior decides their effect |

Token limits, timeouts and untouched settings inherit the selected originals. Configure changes only its explicitly collected fields; Apply reads saved files without model discovery, semantic validation or reseeding removed values. A native custom API prefix does not rewrite AMS helper routes.

## Upstream boundary

TDAI source, manifests and supplied locks are unchanged. AMS supplies no source patches, injected loaders, callback identities, prompt rewrites or session/cancellation corrections. The four TDAI application images use Node 22; AMS tooling and the MCP image use Node 24. The MCP image launches the unchanged Knowledge stdio artifact on its Node 24 runtime. Core and Knowledge currently supply no npm lock, so stock dependency ranges can resolve differently when rebuilt.

MemoryProxy administration uses its native `admin.apiKey`. AMS does not generate or initially seed Core `server.apiKey`; the selected original template leaves it empty. Core service/admin routes therefore lack that guard, and Core remains unpublished by default. Proxy still verifies Core user keys. An operator may configure a Core service key, which AMS preserves; the pinned Proxy user-verification client omits its service Bearer and can then fail with HTTP 401. Native callbacks and request authentication retain upstream behavior.

The separate AMS HTTP MCP gateway connects the official SDK's HTTP and stdio transports directly and isolates callers per request. Each authenticated POST launches a stock stdio process and closes it when the response completes, aborts or fails. No credential pool or persistent MCP session remains. Its internal access boundary supplies the service header and checks user/team/resource permissions through stock APIs. These checks do not change native TDAI handlers. AMS and its MCP transport share the root `package.json` and `package-lock.json`; third-party source metadata belongs in `vendor/`.

Current implementation evidence and its limits are in [validation](VALIDATION.md). Earlier audits of generated configs and source patches are superseded by this contract.
