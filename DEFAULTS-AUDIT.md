# Defaults and deployment differences

Checked on 2026-09-15 against TencentDB Agent Memory revision `0468a2a5b50eaafc54758ed1e2e6609472e5b6ce` and the current Agent Memory Stack generator. This is a source audit, not a live deployment test.

## Baseline: official deployment scripts

The relevant baseline for replacing the original shell-based installation is TDAI's `deploy/global-images/` scripts. Bare configuration-loader fallbacks and the standalone example YAML are a different startup path and sometimes use different values.

An earlier explanation incorrectly described Core's `32000`-token limit and `300000` ms timeout as invented. Both values are explicitly present in [the official Core installer](../TencentDB-Agent-Memory/deploy/global-images/start-memory-core.sh#L143). The temporary change to bare-loader values has been reversed to preserve that installation behavior.

| Setting | Official deployment | Stack |
|---|---|---|
| Core maximum output | `32000` | `32000` |
| Core LLM timeout | `300000` ms / 5 minutes | Same |
| Knowledge maximum output | `32768` | Same |
| Knowledge LLM timeout | `1200000` ms / 20 minutes | Same |
| Core prompt mode | `code` | Same; selectable in setup |
| Skill module and automatic extraction | Enabled | Same |
| Memory capture, extraction, deduplication | Enabled | Same |
| Memories per session | `20` | Same |
| Persona trigger / maximum scenes | `50` / `15` | Same |
| Pipeline: conversations / warmup / L1 idle / L2 delay / min / max | `5` / enabled / `600s` / `90s` / `900s` / `3600s` | Same |
| Recall: results / score / strategy / timeout | `5` / `0.3` / hybrid / `5000ms` | Same |
| Embeddings | Provider `none`, effectively disabled | Same |
| Skill routing / candidates / iterations | BM25 / `20` / `16` | Same |
| Proxy forwarding timeout | `600000` ms | Same |
| Knowledge custom model API / Panel model-binding sync disabled | Set by official Hub installer | Same |

The four output-limit and LLM-timeout questions have been removed from the wizard. Their settings remain editable in `.env`; explicitly saved values remain authoritative. Existing files containing manually chosen values are not silently rewritten.

The generated `skill.extraction.queue.backend: local` field also came from the official script, but the pinned skill resolver no longer consumes that queue section. It is redundant configuration, not an effective queue override.

## Additional MemoryProxy tuning and behavior

These differ from the official Proxy installer and its effective loader defaults. They remain unchanged by this audit and need an explicit decision before cleanup.

| Setting | Official deployment | Stack | Effect |
|---|---|---|---|
| Authentication timeout | `5000ms` | `10000ms` | Longer wait for Core authentication |
| Memory API timeout | `3000ms`; separate sample YAML uses `5000ms` | `10000ms` | Longer wait for memory operations |
| Skill / Knowledge metadata API timeouts | `1500ms` each | `10000ms` each | Longer wait for metadata calls |
| `sessionInit.skipAssetConfirm` | `false` | `true` | Skips the initial asset-association confirmation and treats it as accepted |
| `injection.assetReflection.markerOptIn` | `true` | `false` | Disables the optional `/analyse` route and its reflection injector; it does not remove an approval gate |

Evidence: [our generator](src/config/services.ts), [official Proxy installer](../TencentDB-Agent-Memory/deploy/global-images/start-proxy.sh), [Proxy defaults](../TencentDB-Agent-Memory/MemoryProxy/src/config.ts), [marker handling](../TencentDB-Agent-Memory/MemoryProxy/src/server.ts), and [session confirmation](../TencentDB-Agent-Memory/MemoryProxy/src/session/codebuddy/init.ts).

## Deployment and packaging choices

These are also differences or additions, but serve installation, persistence, or service-access responsibilities rather than model-quality tuning. Their presence does not make them upstream defaults.

| Area | Stack choice | Difference / reason |
|---|---|---|
| Rate limiting | `qpm: 0`, `tpm: 0` | Disables upstream defaults of 100 requests and 1M tokens per minute; standalone deployment has no Redis-backed enforcement |
| Proxy conversation storage | Enabled SQLite with persistent directory | Official Proxy launch config leaves storage disabled |
| Hosted billing | Empty credit-report endpoint, disabled no-op in source patch | Avoids the upstream placeholder reporting endpoint |
| Core storage | Fixed SQLite | Official installer can choose another store backend |
| Model settings | One shared provider URL/key for Core and Knowledge, separate models | Installation interface chosen for this stack |
| CLIProxyAPI | Extra image, retry count `1`, control panel disabled | Our proxy-provider choice; its pinned example uses retry count `3` and enables its control-panel assets. Runtime fallback was not independently verified |
| Logging | Common `info` level | Knowledge's own loader defaults to `debug` |
| Ports and paths | Loopback publishing, mounted data directories, instance ID `ams` | Container networking and persistent installation identity |
| Service access | Service/user authentication, public Knowledge adapter, authenticated callback pairing | Added service boundaries and adapters for this deployment |
| Setup validation | Ports restricted to 1024–65535; origin URLs have no path; data paths exclude `$` and `:` | Stack input-validation choices, not general TDAI restrictions |

Proxy auth, injection, session initialization, TDAI memory, and optional Knowledge integration are enabled by the official deployment as well. Redis and the listed telemetry services are already disabled in the upstream baseline. These should not be reported as invented behavior merely because they are explicit in our generated configuration.

## Source patches beyond configuration

[The patch module](src/patches/apply.ts) also changes upstream application code:

1. Allows Node 24 for MemoryProxy and adds forwarding of request cancellation.
2. Adds the memory injection block to the Responses `instructions` field.
3. Adds access checks, session ownership checks, and authenticated service/callback identities; restricts bridge operations and filters returned assets.
4. Disables session-level caching for Skill/Knowledge listings so permission changes are checked on subsequent requests; rewrites advertised tool addresses and credential references.
5. Makes Knowledge routes and Panel pages follow the selected services, and disables unused credit reporting.

These are deliberate modifications in our delivery, not unchanged upstream behavior. This audit lists their purpose; it does not revalidate every patch's necessity or production correctness.

## Installation UX gap: image manifest

The current wizard asks for a prepared image manifest before startup. The file records image IDs and platforms for verification. It is an internal build artifact and should not be something a first-time user has to understand or manually prepare.

Today, build/load and setup are separate commands: [build entry point](src/build/cli.ts), [image builder](src/build/images.ts), and [setup](src/setup/server.ts). The proposed correction is to let setup reuse verified prepared images or prepare the required images itself, then save/read the manifest internally. This audit does not implement that flow or start any image builds.

## Validation

The four-question removal and `.env` preservation have regression coverage for fresh defaults, saved custom values, and invalid values. Ordinary tests passed; container-dependent tests were not run for this UI/configuration correction. Existing images and published artifacts have not been rebuilt or deployed by this audit.
