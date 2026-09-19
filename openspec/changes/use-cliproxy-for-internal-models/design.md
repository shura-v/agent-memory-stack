> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## Context

See `proposal.md` for motivation. Current `serviceConfigs` passes `LLM_BASE_URL` and `LLM_API_KEY` unchanged to Core and Knowledge, so routing both through `http://cli-proxy-api:8317/v1` already works at the configuration level. Each consumer retains its own model setting. CLIProxyAPI exposes the OpenAI-compatible protocol used by those consumers.

Current setup discovers models from the CLI host before apply; the Compose hostname is not available there. Apply validates all settings first, starts Core/bootstrap and then other services, and offers account login last. Core/Knowledge health endpoints do not verify inference. Existing specs require separate external provider input and apply without configuration questions; the deltas explicitly narrow these contracts for deferred local model selection.

## Goals / Non-Goals

**Goals:** represent internal model source explicitly, derive local credentials consistently, complete first installation without fabricated model names, preserve save-only/cancellation/recovery behavior, and explain both routing modes in the architecture documentation.

**Non-Goals:** new provider protocols, automated agent configuration, an inference benchmark, additional public ports, migration of data/accounts, publication of npm or Pages, or changing MCP authorization and tool routing.

## Decisions

### 1. Explicit source with compatibility-preserving defaults

Add `INTERNAL_LLM_SOURCE=cliproxy|external` to the recognized settings. A new wizard configuration with a local internal consumer and local CLIProxyAPI defaults to `cliproxy`. Existing settings without this field resolve to `external`, preserving their exact explicit API base and key, including manually configured local proxy URLs. Never infer ownership from URL equality alone.

Ask for the CLIProxyAPI account provider before the approved two-option `Models for memory and Knowledge` question. Offer that source question when local CLIProxyAPI and at least one local internal consumer exist. Account authorization still happens during apply. Without local CLIProxyAPI, use the external workflow. Without local Core/Knowledge, ask no internal source/model questions. Explicit `cliproxy` with a consumer but no local proxy fails with a named configuration error. This preserves advanced placements instead of silently adding services.

Use `homedir()/.agent-memory-stack` for `.env`, `compose.yaml`, and `.ams/`. Configure, apply, update, and connection details share this fixed folder, independent of the working directory and `XDG_CONFIG_HOME`. Remove the Compose configuration-directory prompt and target-pointer mechanism; expose no public directory override. `DATA_DIR` defaults to `./data` relative to this folder, and setup retains any saved value exactly without a data-directory question. Operators change that setting manually in `.env`.

Earlier installations elsewhere remain untouched: no automatic migration, deletion, or interpretation of an old `targets.json`. Their existing Compose configuration remains operator-managed. A different project path changes Compose identity and relative data resolution, so copying files alone is not an automatic migration contract.

Alternative: detect local mode from the URL. Rejected because it can change ownership of an existing operator-supplied key.

### 2. Derive effective routing from the selected source

For `cliproxy`, effective base is `http://cli-proxy-api:8317/v1` and effective key is the current `CLIPROXY_API_KEY`. Resolve these values in shared configuration logic consumed by generation, review and connection details. Do not duplicate the service key into a second independently editable credential or rely on shell interpolation. Retained external `LLM_BASE_URL`/`LLM_API_KEY` remain inactive and are reused when the source returns to `external`; display their inactive role in explicit credential details. Key rotation automatically affects internal consumers on apply.

Core and Knowledge retain separate model fields in both modes. The agent still supplies its model in its own requests. Panel must not overwrite either binding. Sharing a proxy means sharing account capacity, not forcing one model for all work.

Alternative: populate two editable copies of the proxy key. Rejected because later rotation can leave one consumer using an obsolete key.

### 3. Save desired settings; complete missing local models during apply

Desired-state validation permits empty consumed model fields only for explicit local mode awaiting selection. Blank fields themselves represent pending work; no extra state file or invented model default is needed. Runtime-complete validation still requires real model IDs. The review explains that local model selection follows authorization. Save-only remains engine-free and preserves the existing Yes/No apply boundary.

Local-mode apply prepares images and snapshots the prior applied state, prepares the proxy's data/configuration through its existing helpers, starts/authorizes local CLIProxyAPI, then obtains models from inside the Compose network. This preparation must not generate consumer configuration with fake models or start/recreate Core and Knowledge before model settings are complete. Reuse existing provider-specific credential checks and login behavior; one active token refresher, no duplicate login at the end of apply.

Apply reads `CLIPROXY_AUTH_PROVIDER` from saved settings and never repeats the wizard's provider selection. This covers both immediate application after `Apply configuration now?` and standalone apply. Matching credentials skip login; missing credentials start authorization for that saved provider. Operators change providers through `.env` before applying.

Use a short-lived existing runtime helper to request the proxy model list with the service key passed through a restricted input/environment, not command arguments or logs. No new host listener is needed. Keep discovery best effort and bounded to five seconds. An empty/unavailable listing offers manual input; an authentication rejection identifies the proxy authorization/service-key failure instead of asking for an unrelated external API key.

Only missing consumed model fields trigger prompts during apply. Reuse valid saved model choices even if a provider no longer lists them. Save each confirmed choice so cancellation resumes remaining work. A subsequent apply with complete models does not replay selection. Noninteractive apply with missing models stops with named fields and guidance rather than hanging. Source changes through navigation discard source-dependent discoveries while preserving service-key stability.

After complete model selection, regenerate and apply the full deployment using existing Core initialization rules. The final applied-input baseline includes the selected source, models and any successfully changed account provider. Failure before full application keeps desired settings and completed OAuth available for retry, leaves existing Core/Knowledge data intact, and preserves the previous successful rollback baseline. A proxy started for initialization may remain for retry; report incomplete setup rather than overall success.

Alternative: start all consumers with arbitrary model placeholders, then reapply. Rejected because it exposes invalid runtime configuration and makes partial-success recovery ambiguous.

### 4. Documentation and diagrams are part of the same change

Update README and operations guidance with both routes and separate model choices. The stack overview must explicitly distinguish the default shared path (Core/Knowledge to CLIProxyAPI) from the optional external API path. Avoid depicting both alternatives as simultaneous unconditional requests. Replace the ambiguous `Internal LLM API` label with a purpose-specific external-provider label or a clearly marked alternative.

Update authored Archify JSON, regenerate standalone HTML and its receipts, and refresh the overview PNG consumed by README and the Pages landing page. Review the MCP detail map and its captions for consistency; its authentication, session and Knowledge tool path remain unchanged. Keep direct Pages links stable and source references tied to the resulting code. Use Archify's existing validation and visual-review workflow rather than editing generated HTML.

## Risks / Trade-offs

- Shared accounts can be unavailable or rate-limited for both inference and background work → explain shared capacity; retain the independent external mode.
- Moving authorization earlier can break partial-apply recovery → reuse snapshots and existing provider checks; test cancellation between authorization, model choices and full application.
- Host-side discovery cannot resolve Compose DNS → perform local discovery inside the Compose network without opening another port.
- Existing external settings could be overwritten by a new default → legacy missing-source settings remain external; local binding requires explicit metadata.
- Container health is not model success → verify one request per internal consumer with authorized test credentials when available and report any unrun provider checks separately; do not claim broad semantic-memory acceptance.

## Migration Plan

Existing installations retain current routing and model values. Operators opt into shared routing by setting `INTERNAL_LLM_SOURCE=cliproxy` with local CLIProxyAPI present, then applying; existing model choices remain theirs to edit. Fresh wizard installations default to local mode when eligible. Switching back to `external` requires valid external base/key and consumed model names before deployment. Recovery uses the previous applied settings and compatible package; no database or OAuth migration is introduced.
