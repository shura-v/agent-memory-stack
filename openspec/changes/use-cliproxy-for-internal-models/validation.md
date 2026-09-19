> Historical validation record. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

# Implementation verification

Verified on 2026-09-19, macOS with Podman, linux/arm64 containers.

- `npm run build` and TypeScript checking passed.
- Standard suite: **312 passed, 15 opt-in tests skipped**.
- OpenSpec strict validation and `git diff --check` passed.
- Both architecture diagrams passed Archify validation (9/9 each) and visual checks; delivery and source-provenance hashes match the final files.

## Isolated container verification

Built all required service images, then ran the runtime smoke fixture with `AMS_RUNTIME_SMOKE=1` and `AMS_INTERNAL_PROXY_SMOKE=1` using Podman and `uvx podman-compose`.

The successful run completed in 142 seconds using the prepared images. It verified:

1. CLIProxyAPI preparation and model discovery before consumer startup; empty discovery uses synthetic manual model choices.
2. Core and Knowledge generated configuration uses `http://cli-proxy-api:8317/v1` with the same current CLIProxyAPI service key.
3. Selected containers start, published interfaces remain on loopback, and HTTP health checks pass.
4. Reapplication retains initialization and keys; cold backup/restore retains the administrator credential.
5. Test containers and networks are removed afterward. The user installation and saved target were not recreated.

The initial cold-build run exceeded the fixture's six-minute limit after successful container startup. The fixture now allows twenty minutes for source downloads, complete image builds, startup and recovery; the retry passed. This changes only the test limit, not service readiness timeouts.

Evidence: `/tmp/ams-internal-models-tests.log`, `/tmp/ams-internal-proxy-smoke-retry.log`, and `/private/tmp/ams-runtime-TkSQfF/validation.json` on the verification machine.

## Validation boundary

The fixture stubs only the account-authorization check and uses temporary synthetic credentials. Real Codex/Claude OAuth login, provider inference, quotas, agent end-to-end behavior and semantic memory/Knowledge quality were not verified. No release or publication was performed.

## Provider-first prompt ordering

After moving the CLIProxyAPI account-provider question before the internal-model source question, `npm run build` and the setup/navigation suites passed (50 tests). The source question now follows the account-provider selection, the account provider is asked once, and existing Esc navigation and generated-key preservation remain covered. Container runtime behavior did not change; container checks were not repeated for this prompt-only follow-up.

## Data directory configured through .env

Removed the data-directory question while retaining the Compose configuration-directory prompt. Fresh setup saves the existing `./data` default, and saved absolute/relative `DATA_DIR` values are preserved without prompting. `npm run build` and the setup/navigation suites passed (50 tests). Container behavior is unchanged and was not rechecked for this prompt-only follow-up.

## Fixed user installation directory

The final location is `homedir()/.agent-memory-stack`; this supersedes the earlier configuration-directory prompt and intermediate `.config` location. Configure, apply, TDAI update and connection details share that directory. The target registry and unused home-input expansion helper were removed. Tests use explicit isolated directories; a child-process check verifies the production location is independent of working directory and `XDG_CONFIG_HOME`.

No existing user configuration or containers were migrated or removed.

Build passed; the full suite passed **308 tests, with 15 opt-in tests skipped**. Obsolete directory/registry tests were replaced by fixed-directory routing and missing-configuration cases. Container checks were not repeated for this host-side configuration change.

## Reuse the configured account during apply

Removed the second provider selector from authorization. The complete immediate setup-to-apply test selects Claude once, authorizes that provider before local model selection, and reuses its credentials on the next apply. Standalone apply uses the saved provider, distinguishes credentials for other providers, checks authorization after login, and preserves configuration and rollback inputs. The obsolete post-apply selector-cancellation fixture now cancels the login operation itself.

Build passed. The final full suite passed **308 tests, with 15 opt-in tests skipped**. Live containers, OAuth, and inference were not rerun.

The separate agent connection guide includes shell launch shortcuts and MCP registration commands. Bash/Zsh syntax and stubbed argument/environment forwarding passed; local documentation links and Pages GIF delivery were checked. These checks do not establish a live agent connection.
