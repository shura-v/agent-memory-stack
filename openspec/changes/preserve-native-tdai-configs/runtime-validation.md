> Historical validation record. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

# Full-stack native configuration runtime validation

Date: 2026-09-19. Host: macOS; engine: Podman 6.1.1; container platform: `linux/arm64`; Compose provider: `uvx podman-compose` with task-local caches. TDAI revision: `0468a2a5b50eaafc54758ed1e2e6609472e5b6ce`.

This record covers the current fixed six-service contract. Every installation uses synthetic credentials, isolated runtime/native roots and its own Compose project. Earlier subset/split-placement acceptance is superseded; `tests/placement-smoke.test.mjs` was removed.

## Full-stack runtime

External internal-model routing: **1/1 passed**, 174 seconds. Installation: `/private/tmp/ams-runtime-oQQkxr`; project: `ams-ac684a89bd`; log: `/private/tmp/ams-full-stack-acceptance.JYwtfV/runtime-external.log`.

Local CLIProxyAPI internal-model routing: **1/1 passed**, 144 seconds. Installation: `/private/tmp/ams-runtime-WoY53j`; log: `/private/tmp/ams-full-stack-acceptance.JYwtfV/runtime-local.log`.

Both runs verify all six application services, all seven image identities and all five native documents; native effective-generation equality; per-service read-only mounts; authenticated routes and loopback publication; repeated application with stable administrator identity; and cold Core credential recovery. Local mode also confirms that Core and Knowledge consume distinct model names through the same authenticated local CLIProxyAPI. The provider account check is stubbed; no real account is installed or used.

The runtime image was rebuilt from current sources as `sha256:798b262ce699620785111f47551d71a11edae8304533e7dda0c737140df94349`. Complete image/platform records are retained in both isolated installations' `.ams/images.json` and `/private/tmp/ams-full-stack-acceptance.JYwtfV/evidence.json`.


| Image | Content identity |
| --- | --- |
| core | `sha256:49c1448de325cecd71c636d4ccfb86e843e03cbe7ce6e0a162595ab992f53563` |
| knowledge | `sha256:ef22e38649841719fdfad9aeb2f48b4d62e6e468c4c29b2e931f27d716f5cfde` |
| panel | `sha256:51f435e1551bd82e1e0deee09504f31914e13dba0255075b5da86ed8b2478329` |
| memory-proxy | `sha256:20f6cf1c56a7dac7a53c3253f0876060806f7395faaef147e3f64367c8a38c1a` |
| runtime | `sha256:798b262ce699620785111f47551d71a11edae8304533e7dda0c737140df94349` |
| cli-proxy-api | `sha256:1afb159d8a02a749ab79af8136c6d2b958ca371fcf28bf3ca55c5d76a9eaef4b` |
| mcp | `sha256:7c9d44498b2793dbaa05909eed46d2c25442fa10eabc4dfc60e04d5c1192c5eb` |

## Native loaders and synthetic model

Native loaders: **5/5 passed**, 2.75 seconds. `AMS_UPSTREAM_CONFIG_TEST=1 AMS_CONTAINER_ENGINE=podman node --test tests/upstream-config.test.mjs` exercises Core, Knowledge, Proxy and Panel using exact defaults plus partial overrides, including edited options and literal credentials. Log: `/private/tmp/ams-full-stack-acceptance.JYwtfV/upstream-loaders.log`.

Synthetic model: **1/1 passed**, 106.8 seconds. Installation: `/private/tmp/ams-model-lDe12o`; log: `/private/tmp/ams-full-stack-acceptance.JYwtfV/model.log`. The test verifies Responses and Chat forwarding, Knowledge prompt injection without credential disclosure, no-task L0 persistence through Core and Panel, and SSE cancellation without replay. The model fixture connects through the real local CLIProxyAPI using a synthetic OpenAI-compatible provider. It uses an isolated Compose mount override for that provider and preserves the validated native documents and frozen generation.

## Installed package

The archive at `/private/tmp/ams-full-stack-package.JCct3b/agent-memory-stack-0.1.0.tgz` passed offline installation and save-only setup with network, image preparation and engine operations prohibited. The harness verifies five exact defaults and partial overrides, an independent Proxy administrative key, six applications/four helpers/seven images, restricted file permissions and absence of installation data in the package. Exact commands and results: `/private/tmp/ams-full-stack-package.JCct3b/report.md`; harness: `verify.mjs`; output: `verify.log`.

## Reproduction and cleanup

Runtime smoke uses `AMS_RUNTIME_SMOKE=1`; local mode additionally sets `AMS_INTERNAL_PROXY_SMOKE=1`. Both use `AMS_CONTAINER_ENGINE=podman`, `AMS_COMPOSE_PROVIDER=uvx-podman-compose`, an isolated seven-image manifest and task-local `UV_CACHE_DIR`/`UV_TOOL_DIR`. The initial external run reused `/private/tmp/ams-runtime-DJXO7r/.ams/images.json` as build input; later runs use the verified current manifest from `/private/tmp/ams-runtime-oQQkxr`.

Cleanup verified zero remaining containers in all five test Compose projects and zero remaining synthetic model containers. Results and all seven image identities are recorded in `/private/tmp/ams-full-stack-acceptance.JYwtfV/evidence.json`. The existing user installation remained running and was not targeted.

## Boundaries

No production deployment or real OAuth/provider inference was performed. Docker Linux amd64, semantic L1/L2/L3 memory quality, Wiki ingestion and application database rollback remain untested. Template updates use deterministic source fixtures; container runs use the pinned upstream revision. Native snapshot restoration is covered by host tests; cold container restore checks Core identity using frozen generation inputs.
