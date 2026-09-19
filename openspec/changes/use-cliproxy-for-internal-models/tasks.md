> Earlier implementation plan. Current behavior is specified in [the synchronized main specs](../../specs/) and [the stock integration change](../simplify-stock-tdai-integration/). The complete six-application stack, three AMS helpers, source-acquired flat defaults/overrides, Configure-only model choices and unmodified TDAI supersede conflicting statements below. Past checks establish only their recorded environment and implementation.

## 1. Source settings and effective configuration

- [x] 1.1 Add `INTERNAL_LLM_SOURCE`, preserve legacy external routing, and derive local base/key from CLIProxyAPI in deployment/configuration logic and the environment template; verify configuration cases for both modes, missing local proxy and service-key rotation.
- [x] 1.2 Separate saved desired-state validation from complete runtime validation so only pending local model fields can be empty; verify external missing fields still fail and no generated consumer config contains placeholder model IDs.

## 2. Source-aware setup and model choices

- [x] 2.1 Add the approved English source choices with local mode selected only for eligible fresh installations; reuse existing keys, preserve external settings and support back navigation; verify setup cases for fresh, legacy, Core-only, Knowledge-only and no-consumer placements.
- [x] 2.2 Reuse separate model selectors and manual-entry fallback after authorization for local mode, preserving the existing external discovery path; verify saved models, empty discovery, five-second timeout and authentication-error behavior.
- [x] 2.3 Ask for the CLIProxyAPI account provider before `Models for memory and Knowledge`; verify prompt ordering and back navigation while preserving service keys and deferred authorization/model selection.
- [x] 2.4 Remove the data-directory question; verify `DATA_DIR=./data` defaults relative to the configuration folder and exact retention of saved paths, with changes made through `.env` only.
- [x] 2.5 Describe CLIProxyAPI in the service list as connecting AI accounts and subscriptions to the stack.
- [x] 2.6 Use `homedir()/.agent-memory-stack` for configure/apply/update/details; remove the configuration-directory prompt and target-pointer mechanism, verify working-directory/XDG independence and `.env`-editable data-path retention, and preserve old installations without automatic migration or deletion.
- [x] 2.7 Reuse the saved CLIProxyAPI account provider during immediate and standalone apply without repeating its selection; verify provider-specific authorization and the complete wizard-to-apply flow.

## 3. Apply preparation and recovery

- [x] 3.1 Add a local CLIProxyAPI preparation/authorization stage using existing runtime helpers and provider checks, then discover models from its Compose network; verify ordering and that no new host port or second token refresher is introduced.
- [x] 3.2 Save each deferred model choice and complete normal deployment only after runtime settings are valid; verify save-only, immediate/deferred apply, cancellation after login/one model, missing noninteractive fields and prompt-free reapply with complete choices.
- [x] 3.3 Record final source/model/provider choices in the successful applied-input baseline and preserve the prior baseline on failure; verify the existing snapshot/retry tests and update explicit connection details to show effective local routing alongside inactive external settings without changing routine secret redaction.

## 4. Documentation and architecture diagrams

- [x] 4.1 Update README, operations guidance, environment examples and affected Pages text with the shared and external routes, independent model choices and deferred local selection; verify examples agree with effective configuration and existing links remain valid.
- [x] 4.2 Update the authored stack architecture specification to distinguish default shared routing from the optional external route and replace the ambiguous internal-provider label; review MCP detail/captions for consistency, then regenerate affected standalone HTML and receipts with Archify and verify source references and visual layout.
- [x] 4.3 Refresh `docs/images/agent-memory-stack-overview.png` from the final diagram and keep README/Pages references aligned; verify the static overview and interactive diagrams show the same alternatives and unchanged MemoryProxy/MCP separation.

## 5. Delivery verification

- [x] 5.1 Run the relevant automated checks once, build required images and start an isolated configured stack; report container startup separately from provider/inference checks, record any unavailable real-account checks, and avoid claiming comprehensive agent or semantic-memory acceptance.
