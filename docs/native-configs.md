# Native TDAI configuration

Edit `overrides/`, then run `ams apply`. AMS combines the selected TDAI defaults with your overrides and supplies the resulting native documents to the services.

## Two visible configuration sets

The native root defaults to `~/.config/agent-memory-stack`, or `$XDG_CONFIG_HOME/agent-memory-stack` when `XDG_CONFIG_HOME` is absolute. The runtime remembers that location in `~/.agent-memory-stack/.ams/native-config.json`. Relative roots and occupied unassociated directories are rejected.

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

Initial Configure obtains the selected verified source archive from download, cache or an offline bundle and extracts all five originals directly into `defaults/`. There are no revision subdirectories or packaged template copies. This requires no image build or running engine. Every installation initializes all five native documents for the complete local stack. Make edits in overrides: changes to the managed defaults fail their checksum check. An absent override field inherits the current upstream default. The ordinary apply/update flow does not reseed deleted overrides or restore earlier wizard answers. Explicit wizard changes update their selected fields and preserve unrelated overrides.

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

To change internal model routing, set `INTERNAL_LLM_SOURCE=external` or `cliproxy` in runtime `.env`, set the matching endpoint/key overrides for both Core and Knowledge, and apply. Core and Knowledge have independent settings. Changing a shared key does not silently rewrite explicit overrides. Keep consumer credentials aligned yourself; authentication failures are reported by the running services. Initial automatic host-port allocation fills pending local origins. Later port changes preserve explicit origins and report required adjustments, including Caddy upstream ports.

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

Every update stages all five new templates and composes them with existing overrides. AMS checks document syntax, overlay/deletion instructions, template provenance, root ownership, input freshness and image records before activation. Explicit overrides keep priority even when defaults change. Removed or structurally changed upstream paths addressed by overrides produce redacted diagnostics. Native and orchestration values are operator-owned: AMS does not enforce host/service ports, DATA_DIR, engine/provider choices, paths, URL shapes, API prefixes, model names, credentials or matching connections. TDAI loaders and runtime checks can reject them or fail startup. Correct service failures in overrides and apply again.

No populated baseline, private service-value seed or merge-resolution file is used. A change during preparation invalidates the prepared candidate. Missing templates, changed default hashes, malformed documents or deletion instructions, and failed image preparation retain the active generation. Passing these checks does not prove that TDAI will accept the configured values. Standalone configuration check reads the composed installation and checks document structure and provenance; it does not validate configured values.

Apply mounts an immutable effective generation read-only. Editing overrides affects the next apply, not the running generation. Overrides and recovery snapshots can contain secrets; retain restricted permissions. Offline bundles contain the verified source archive and matching image provenance. Originals are extracted into the same flat defaults layout; installation overrides stay outside the bundle. Ordinary Apply reads existing defaults and overrides without fetching templates again.

Changing native listener ports, paths or API prefixes passes those values to TDAI; it does not automatically reconfigure Compose mappings, helper URLs or health checks. AMS helpers still use their existing `/v3` routes. A custom prefix being accepted by configuration composition does not mean the integrated stack supports it.

## Native Proxy administration

Initial Proxy setup writes an independent 32-byte `sk-ams-proxy-admin-…` credential to `overrides/proxy.yaml` at `admin.apiKey` when none was supplied. It remains stable across apply and updates. After setup, operator edits—including emptying, deleting or reusing a credential—are preserved. AMS does not validate native key contents or regenerate a removed override; normal default inheritance and explicit deletion still apply. Native TDAI controls the resulting authentication behavior.

The initially generated credential is independent of Panel/Core administrator login, agent keys and service credentials. Native administrative handlers use their own `checkAdminAuth` check; AMS adds no guard to TDAI. With the separate generated key, ordinary user keys do not satisfy native instance-administration authentication. This does not add ownership checks to unrelated native session handlers. **Show connection details** labels the effective admin key separately; routine output hides credentials.

## Recovery

A configuration snapshot carries exact defaults, overrides, deletion declarations, template provenance, initial-origin state and the runtime root association with matching source/image records. To recover, first preserve `.ams/previous-settings` outside the installation, stop its writers, and restore the matching runtime snapshot and compatible package/images/data. From the matching AMS checkout or installed package, restore its native state:

```sh
node dist/runtime/restore-native.js ~/.agent-memory-stack /absolute/path/to/saved-previous-settings
```

Then run `ams apply`. Incomplete TDAI snapshots are rejected; a leftover native directory is not adopted without its saved association. Configuration recovery does not roll back application databases. A cold backup includes the complete `DATA_DIR`, native root and runtime `.env`, `compose.yaml`, `.ams`; keep only one active OAuth refresher.
