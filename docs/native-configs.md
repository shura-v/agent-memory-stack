# Native TDAI configuration

Edit `overrides/`, then run `ams apply`. AMS combines the selected TDAI defaults with your overrides and supplies the resulting native documents to the services.

## Two visible configuration sets

The native root defaults to `~/.config/agent-memory-stack`, or `$XDG_CONFIG_HOME/agent-memory-stack` when `XDG_CONFIG_HOME` is absolute. Runtime `~/.agent-memory-stack/.ams/native-config.json` remembers that location and whether initial generated origins were finalized. If the reference is missing, AMS reads complete `defaults/` and `overrides/` from the selected root, preserves their values and recreates the reference during Configure or Apply. Incomplete or malformed native documents remain an error. Other files can coexist in the directory and are preserved during initial setup. Relative roots are rejected. AMS creates no state, ownership or checksum file in the native root.

| Set | Contents | On a TDAI update |
| --- | --- | --- |
| `defaults/` | Complete, exact original upstream templates; inspect these for available settings and examples | Replaced together by the selected revision's verified templates |
| `overrides/` | Partial native files containing initial AMS settings and your edits | Preserved, including comments and credentials |

Each set uses the same native filenames:

| File | Upstream source |
| --- | --- |
| `core.yaml` | MemoryCore `tdai-gateway.yaml` |
| `proxy.yaml` | MemoryProxy `config.example.yaml` |
| `knowledge.env` | MemoryKnowledge `.env.example` |
| `panel.env` | MemoryPanel `.env.example` |
| `panel-instances.json` | MemoryPanel `metadata-instances.example.json` |

Initial Configure obtains the selected verified source archive from download, cache or an offline bundle and extracts all five originals directly into `defaults/`. There are no revision subdirectories or packaged template copies. This requires no image build or running engine. Every installation initializes all five native documents for the complete local stack. Both directories are operator-owned. Direct edits to defaults are accepted by ordinary Configure and Apply; use overrides when a change must survive a TDAI update, because an explicit update replaces all five defaults. An absent override field inherits the current default. Ordinary runs do not reseed deleted overrides or restore earlier wizard answers. Explicit wizard changes update their selected fields and preserve unrelated overrides.

Runtime `.env`, `compose.yaml`, image records, data and OAuth remain in `~/.agent-memory-stack`. Its `.env` owns host ports, `DATA_DIR`, CLIProxyAPI and helper settings. TDAI service values come from the two native sets. Effective container generations are derived runtime copies, not another configuration source to edit.

## Editing settings

For example, override only Core's model in `overrides/core.yaml`:

```yaml
llm:
  model: my-memory-model
```

Other `llm` fields inherit defaults unless they already have entries in your override file. Initial setup supplies known installation settings there, including model connections and credentials.

| Setting | Core override | Knowledge override |
| --- | --- | --- |
| Model | `llm.model` | `LLM_MODEL` |
| API base and key | `llm.baseUrl`, `llm.apiKey` | `LLM_BASE_URL`, `LLM_API_KEY` |
| Output-token limit | `llm.maxTokens` | `LLM_MAX_TOKENS` |
| Timeout in milliseconds | `llm.timeoutMs` | `LLM_TIMEOUT_MS` |

Proxy's model connection is `upstream.url` / `upstream.apiKey`; its Core connection is `tdai.endpoint` / `tdai.apiKey`. Panel's Core connection belongs to its `ams` instance in `overrides/panel-instances.json`. Panel's Knowledge address is `KNOWLEDGE_SERVICE_URL` in `overrides/panel.env`; Knowledge's callback address is `TMC_CALLBACK_URL` in `overrides/knowledge.env`.

To change internal model routing, set `INTERNAL_LLM_SOURCE=external` or `cliproxy` in runtime `.env`, set the matching endpoint/key overrides for both Core and Knowledge, and apply. Core and Knowledge have independent settings. Changing a shared key does not silently rewrite explicit overrides. Keep consumer credentials aligned yourself; authentication failures are reported by the running services. Initial automatic host-port allocation stages pending local origins. Startup retries recalculate those generated origins for newly allocated ports; successful activation saves them. Operator-supplied origins remain intact. Later port changes preserve saved origins and report required adjustments, including Caddy upstream ports.

Public URLs also have explicit owners:

| Advertised URL | Edit |
| --- | --- |
| MemoryProxy links in native prompts | `overrides/proxy.yaml`: `injection.externalGatewayUrl` |
| MemoryProxy endpoints shown in Panel | `overrides/panel-instances.json`: the `ams` instance's `proxy_endpoint` |
| Optional direct Knowledge HTTP tools | `overrides/knowledge.env`: `KNOWLEDGE_PUBLIC_BASE_URL`, including `/v3`; publish the access gateway with `KNOWLEDGE_TOOLS_PUBLIC_ENABLED=true` in runtime `.env` |
| Panel URL shown by AMS | `PANEL_PUBLIC_URL` in runtime `.env` |
| MCP URL used by an agent | The agent's MCP registration, with `/mcp` |

Follow [the Caddy guide](caddy.md#2-set-public-origins) to set matching Proxy and Panel origins. Runtime `.env` values named `MEMORY_PROXY_PUBLIC_URL` or `KNOWLEDGE_PUBLIC_URL` do not replace the effective native fields during Apply.

## Overlay rules and deletion

Mappings combine recursively. Arrays replace as a whole; explicit scalars and null replace the corresponding default. Empty strings, false, zero and null are values, not deletion. An empty mapping adds no child overrides. Remove an override entry to inherit the selected revision's default again.

To remove a field entirely from the effective configuration, use optional `overrides/deletions.json`:

```json
{
  "core.yaml": ["/optionalSection"],
  "knowledge.env": ["/OPTIONAL_SETTING"]
}
```

Paths use JSON Pointer: escape `/` in a key as `~1` and `~` as `~0`. Remove whole arrays rather than indexed elements. An absent target is a no-op. Setting and deleting the same field is rejected; editing one sibling and deleting another is allowed. AMS permits deletion of native service fields; TDAI may reject the resulting document when it loads or starts. The deletion manifest is not passed to TDAI. Removing a deletion declaration restores inheritance.

YAML and env keep native service semantics. AMS delivers files without shell evaluation. Core may expand `${VARIABLE}` in YAML; dotenv double quotes interpret `\n` and `\r`. Native parser behavior determines the runtime value, including its limitations. AMS supplies no private codec or corrective loader. Knowledge and Panel read `/app/.env`; Core and Proxy read their native YAML paths.

## Updates and validation

Every explicit update stages all five new templates and composes them with existing overrides. AMS checks the downloaded source archive, document syntax, overlay/deletion instructions, input freshness and image records before activation. Explicit overrides keep priority when defaults change. Removed or structurally changed upstream paths addressed by overrides produce redacted diagnostics. Native and orchestration values are operator-owned: AMS does not enforce host/service ports, DATA_DIR, engine/provider choices, paths, URL shapes, API prefixes, model names, credentials or matching connections. TDAI loaders and runtime checks can reject them or fail startup. Correct service failures in either visible set and apply again.

No populated baseline, private service-value seed, persisted template manifest or merge-resolution file is used. A change during preparation invalidates the prepared candidate. Missing documents, malformed documents or deletion instructions, and failed image preparation retain the active generation. Passing these checks does not prove that TDAI will accept the configured values. Standalone configuration check reads the composed installation and checks document structure; it does not compare defaults with upstream or validate configured values.

Apply mounts an immutable effective generation read-only. Editing overrides affects the next apply, not the running generation. Overrides and recovery snapshots can contain secrets; retain restricted permissions. Offline bundles contain the verified source archive and matching image provenance. Originals are extracted into the same flat defaults layout; installation overrides stay outside the bundle. Ordinary Apply reads existing defaults and overrides without fetching templates again.

Changing native listener ports, paths or API prefixes passes those values to TDAI; it does not automatically reconfigure Compose mappings, helper URLs or health checks. AMS helpers still use their existing `/v3` routes. A custom prefix being accepted by configuration composition does not mean the integrated stack supports it.

## Core service authentication

AMS leaves Core `server.apiKey` to native configuration and does not generate or initially seed it. The selected original template leaves it empty. With an empty key, Core skips its native service guard, including for `/v3/instance/destroy` and other routes without a separate user check. Core stays unpublished by default. Proxy still verifies the agent's Core user key, and AMS MCP/access still enforce their user/resource checks.

Keep the native client token fields nonempty: the selected Proxy template supplies `local` for `tdai.apiKey`, `skill.serviceToken` and `knowledge.serviceToken`; AMS preserves those defaults when no Core service key is configured. The initial Panel `ams` instance likewise uses `api_key: "local"`. These public values satisfy native client/registry requirements. They provide no Core service authentication while Core `server.apiKey` is empty, and they are not agent user keys. Clearing Core's guard does not require clearing these client fields.

You can set `server.apiKey` in `overrides/core.yaml`; Configure, Apply and updates preserve that explicit value. Keep the corresponding native consumer credentials aligned. The pinned Proxy omits the service Bearer in its user-verification request, so enabling this optional key can cause Proxy requests to fail with HTTP 401. AMS supplies no source patch or automatic repair.

To deliberately clear a saved Core service key, set this override and run `ams apply`:

```yaml
server:
  apiKey: ""
```

This changes neither Core user identities nor the separate Proxy administrative key. Defaults remain unchanged, and Apply does not clear an operator-supplied Core key automatically.

## Native Proxy administration

Initial Proxy setup writes an independent 32-byte `sk-ams-proxy-admin-…` credential to `overrides/proxy.yaml` at `admin.apiKey` when none was supplied. It remains stable across apply and updates. After setup, operator edits—including emptying, deleting or reusing a credential—are preserved. AMS does not validate native key contents or regenerate a removed override; normal default inheritance and explicit deletion still apply. Native TDAI controls the resulting authentication behavior.

The initially generated credential is independent of Panel/Core administrator login, agent keys and service credentials. Native administrative handlers use their own `checkAdminAuth` check; AMS adds no guard to TDAI. With the separate generated key, ordinary user keys do not satisfy native instance-administration authentication. This does not add ownership checks to unrelated native session handlers. **Show connection details** labels the effective admin key separately; routine output hides credentials.

## Recovery

A configuration snapshot carries exact defaults, overrides and deletion declarations. The matching runtime inputs carry the native-root reference, initial-origin state, selected source and images. To recover, first preserve `.ams/previous-settings` outside the installation, stop its writers, and restore the matching runtime snapshot and compatible package/images/data. From the matching AMS checkout or installed package, restore its native configuration:

```sh
node dist/runtime/restore-native.js ~/.agent-memory-stack /absolute/path/to/saved-previous-settings
```

Then run `ams apply`. Incomplete TDAI snapshots are rejected. A missing runtime reference does not require manual repair when the selected native root contains complete composable files; normal Configure or Apply saves the reference again. Configuration recovery does not roll back application databases. A cold backup includes the complete `DATA_DIR`, native root and runtime `.env`, `compose.yaml`, `.ams`; keep only one active OAuth refresher.
