# Delivery validation

Updated: 2026-09-19. Tests use synthetic credentials and isolated data. The user's existing stack is outside the test projects.

## Acceptance scope

The sole acceptance criterion for the two archived delivery changes is **required images built and selected containers started**. Long-running containers must remain running at the recorded observation point; required one-shot initialization jobs must complete successfully. The local image/startup evidence below records that scope. It does not assert that every later user installation is currently running.

Comprehensive agent, MCP, provider, memory/Wiki, authorization, and full recovery validation is deferred until Supergateway and the remaining integrations are implemented. These checks are outside the archived changes' completion criteria. Existing test results below remain historical evidence; unchecked functional acceptance has not been converted into a pass.

## Current CLI verification

### MCP lifecycle methods and selected-image exports — 2026-09-19

Missing upstream sessions now return HTTP 404 for POST, GET and DELETE. The gateway recognizes Supergateway's method-specific JSON or plain-text error and removes the stale local entry; unrelated 400 responses retain their status and bytes. Real Supergateway regressions cover session loss and successful reinitialization for all three methods.

Configured exports select the images required by the saved `.env`, including helper images, before checking revisions. Retained inactive image records stay unchanged locally and cannot block export after a TDAI update. Export without deployment settings retains the full-manifest contract. A real-tar/simulated-engine regression exports updated Core plus runtime with stale Panel retained locally, imports the bundle and reuses its images without rebuilding.

`npm test`: **282 passed, 15 opt-in skipped, 0 failed**. TypeScript build and all **22 gateway tests** passed. Container build/start acceptance was not rerun; no existing installation was changed.

### Lost upstream MCP sessions signal reinitialization — 2026-09-19

The gateway translates the pinned Supergateway's specific missing-session HTTP 400 response into HTTP 404 and removes its local session entry. Other 400 responses retain their status and bytes; inspection buffers at most 64 KiB before switching to passthrough streaming.

`npm test`: **276 passed, 15 opt-in skipped, 0 failed**. All **18 gateway tests passed**. A real Supergateway regression invalidates a session with an unsupported protocol version, verifies 404 on the subsequent valid request, and successfully initializes a new session and lists tools. Container build/start acceptance was not rerun; these tests use local subprocesses and synthetic credentials.

### Failed MCP initialization releases its worker slot — 2026-09-19

Unused failed-initialization workers are removed from the pool before process shutdown is awaited. A stale lease cannot remove a replacement worker. The real pinned Supergateway regression now verifies an initial HTTP 415 followed immediately by a successful initialization and tool listing, without an intermediate HTTP 503.

`npm test`: **274 passed, 15 opt-in skipped, 0 failed**. All **16 gateway tests passed**, including pool capacity release during pending shutdown and preservation of established sessions. Container build/start acceptance was not rerun for this fix; the real Supergateway regression runs as a local subprocess with synthetic credentials.

### Review fixes: initialization recovery, image bundles and provider rollback — 2026-09-19

Interrupted administrator initialization resumes with the existing active credential and creates missing defaults. An interrupted reinitialization also marks old Core completion as incomplete while preserving the installed-service inventory. TDAI image bundles include checksum-protected source selection, verify it against image revision labels and restore it during import. Successful provider authorization updates the applied-input baseline; failed authorization keeps the requested provider for retry without advancing that baseline.

`npm test`: **271 passed, 15 opt-in skipped, 0 failed**. Regressions cover partial initialization and retries, imported-image reuse without a network/build fallback, source metadata corruption and revision mismatches, and rollback after switching providers. Bundle regressions use real tar archives with a simulated container engine.

The isolated Podman runtime smoke also **passed in 292 seconds**: changed MCP/runtime images built, selected containers started, fresh initialization and repeat Apply succeeded, and cold credential restoration passed. The fixture used synthetic credentials in `/private/tmp/ams-runtime-y7ICUN`; its test containers were removed. The user's stack was not restarted. Real provider login, remote delivery, external agents and Wiki semantics were not tested by this run.

### Connection details grouped by service — 2026-09-19

Connection details now pair each service's address/port with its matching credentials in the same plain-text block. Panel includes administrator login keys; MemoryProxy and MCP each include user keys. Core, CLIProxyAPI, internal LLM and saved remote connections include their own credentials and clearly identify private or inactive addresses. User-key values are read once and reused across blocks.

TypeScript build and **30 focused tests passed**; after completing the published CLIProxyAPI URL, all **7 presenter tests passed** again. Coverage includes adjacent credential/address pairing, administrator roles, no duplicate key reads, retained remote credentials, unavailable Core and explicit host-port exposure. This is a presentation change; containers were not restarted and container acceptance was not rerun.

### All-key connection display — 2026-09-19

The explicit **Show connection details** screen now prints all configured `.env` secret fields, including retained remote credentials, and every active, unexpired local Core user key, including administrator keys. There is no key-selection prompt. Each value has a label and its own copyable line; one unavailable Core key does not prevent displaying the remaining keys, and Core failures retain the `.env` output. Apply/update still print only a recommendation to open the screen.

**257 tests passed, 15 opt-in tests skipped, 0 failed.** Presenter regressions cover all-key output, inactive-but-saved remote credentials, administrator labeling, per-key failure continuation, unavailable Core, and unchanged configuration bytes. The runtime reader and container lifecycle are unchanged; container acceptance was not rerun for this presentation change. The earlier build/start evidence below remains historical.

### Explicit connection details — 2026-09-19

`ams` now includes **Show connection details**. A real TTY invocation showed all three menu items, kept Configure stack selected, and cancelled without runtime effects. Successful Apply/update ends with a recommendation to open this screen; existing keys are not printed automatically. The screen lists saved listener settings and reads the selected existing user key through captured exec on the verified local Core using read-only SQLite. It does not create, rotate, or persist credentials.

**257 standard tests passed, 15 opt-in tests skipped, 0 failed.** The explicit Podman runtime smoke also passed (169 seconds): changed MCP/runtime images built, selected containers started, initialization completed, metadata listing omitted the full key, and explicit key lookup matched the generated synthetic administrator key. The same run passed repeat application and cold credential restoration. Image identities, platform, runtime and selected services are recorded in [connection-details-start.json](docs/validation/connection-details-start.json). Temporary test containers were removed; the user's stack was not restarted. Real provider login, external agents, Wiki and VPS/Caddy were outside this run.

### Review fixes: MCP session lifecycle and administrator handoff — 2026-09-19

The gateway preserves established sessions and concurrent initializations when another initialization fails. Failed initialization only stops an otherwise unused worker. JSON-RPC initialization IDs are validated with the SDK request schema. A regression using the pinned real Supergateway verifies that a second initialization returning HTTP 415 does not prevent the first session from calling `tools/list` and closing normally.

`npm test`: **242 passed, 15 opt-in skipped, 0 failed**. Both corrected smoke fixtures were also run explicitly on isolated Podman Compose installations with synthetic credentials: **runtime lifecycle/cold credential restore passed** (222 seconds), and **synthetic model instructions/L0 persistence/Panel access/SSE cancellation passed** (104 seconds). The fixtures capture the generated administrator key from setup and use it for authenticated requests. They configure test network settings through `.env`, use resolved local ports, and stub account authorization only; Core initialization uses the production runtime.

Required images were built and the temporary stacks started successfully. These runs used no real model provider or account login and did not restart the user's existing stack. They do not certify real agent, Wiki, VPS/Caddy, or external model-provider behavior.

### Server MCP gateway — completed 2026-09-16

Node.js 24.18.1: **202 tests passed**, **15 opt-in tests skipped**, **0 failed**.
Coverage includes all 63 service subsets, protected tool forwarding, current-user
verification, credential-bound sessions, cancellation, bounded worker/session
lifecycle, and Core/Knowledge identity pairing. These are focused implementation
checks, not comprehensive agent or authorization acceptance.

**Build-and-start acceptance passed** on Podman **6.1.1**, podman-compose
**1.6.0**, **linux/arm64**. An isolated MCP-only Compose project started the new
MCP image and a new protected-access helper using the rebuilt runtime image.
Both long-running containers were **running/healthy** at **00:59:06 UTC**;
the one-shot configuration job exited **0**. Only MCP published a host listener,
at **127.0.0.1:8425**. Core/Knowledge pairing reported no pending dependencies.
The existing installation supplied Core and Knowledge as read-only dependencies;
this MCP-only selection required no Core bootstrap, administrator input, provider
login, or inference. Existing application containers were not restarted.

| Image | Content identity |
| --- | --- |
| MCP | `sha256:b3cada558463ec79b32c4e1c97b6094690897110f3b4b5ad1c0468e59217c8ea` |
| Runtime | `sha256:5999aec86601716147729e70a067fb1213832762e0c34611b43cb71297da379b` |

The MCP image locks Supergateway 3.4.3 and MCP SDK 1.30.0. Its build applied the
exact-match container-loopback and direct-adapter-spawn patches successfully.
The sanitized observation is in `artifacts/mcp-start.json`. Test containers and
temporary credential copies were removed after recording startup; the original
installation's explicit service selection was preserved. This run did not certify
a fresh six-service installation, Docker/AMD64 execution, VPS/Caddy forwarding,
real agent registration, Wiki search, concurrent-user isolation under load, or
recovery. Those remain part of the later comprehensive validation phase.

### Apply menu and command — completed 2026-09-16

The initial menu now contains **Configure stack** (default) and **Apply configuration**. Both the Apply action and standalone `ams apply` use the same remembered installation and application workflow, bypassing the Configure stack detection guard. `ams apply server` is no longer accepted; current prompts and README use the short command. Node.js 24.18.1: **182 tests passed**, **15 opt-in tests skipped**, **0 failed**. A real TTY invocation showed both menu items and cancelled without runtime effects. Command routing, missing saved configuration, and apply-without-setup behavior are covered by focused tests. This change did not apply configuration or restart containers.

### Selected-provider authorization — completed 2026-09-16

`CLIPROXY_AUTH_PROVIDER` now selects `codex` (default) or `claude` in setup and `.env`. Apply checks saved, enabled credentials of that exact provider through a read-only auth-directory mount in a network-disabled runtime container. Credentials for another provider cannot satisfy the selection. The model-list heuristic below has been removed. The selected login flag is used and saved authorization is checked again after login; existing accounts are retained. MemoryProxy and Panel output now labels their interfaces as `agent API` and `web interface` respectively.

Node.js 24.18.1: **181 tests passed**, **15 opt-in tests skipped**, **0 failed**. The rebuilt linux/arm64 runtime image is `sha256:32c8156cbde406565b244b63010121bd14c1132ca67d76cb414f1696f9504c19`. Its helper ran successfully on the user's saved auth directory and returned only `codex: true`, `claude: false`. Application containers were not restarted, credentials were not changed, and no login or inference was performed. Claude's browser/manual callback flow was verified against the pinned source and command arguments; a real Claude OAuth round trip remains untested. Saved credentials do not establish token freshness or account validity.

### Repeated provider-login prompt — corrected 2026-09-16

Apply now uses the existing model-list probe to skip optional ChatGPT login when local CLIProxyAPI lists provider models. Node.js 24.18.1: **171 tests passed**, **15 opt-in tests skipped**, **0 failed**. Coverage includes an existing model list, an empty list retaining the optional login offer, and malformed model entries. A read-only probe using the updated integration module against the running user stack returned `{"pending":[],"modelAvailable":true}`. No login or inference was performed; a populated model registry is not proof of token freshness or successful inference. The probe initially encountered the user's concurrent Apply with CLIProxyAPI stopped, then succeeded after that service started. This correction did not itself rebuild or restart application containers; image preparation will rebuild the changed runtime image on the next Apply.

### Menu-before-detection correction — completed 2026-09-16

The initial menu now waits for the operator to choose **Configure stack** before inspecting existing containers. A real TTY run stayed at that menu until Enter, then printed the existing `.env` location and exited without configuration questions. TypeScript build and all **17 command/navigation tests** passed, including menu cancellation without engine inspection. `ams apply server` is unchanged. This CLI-only correction did not rebuild images or restart containers; the build/start observation below remains its recorded evidence. It supersedes the earlier before-menu behavior described below.

### Existing-container setup guard — completed 2026-09-16

Node.js 24.18.1: **169 tests passed**, **15 opt-in tests skipped**, **0 failed**; TypeScript checking passed. A real interactive `ams` invocation detected the existing complete stack, printed `server/.env` guidance and `ams apply server`, and exited successfully before any menu or question. Detection includes stopped containers and bounds each read-only engine command to five seconds. It introduces no installation registry or recovery flow.

**Build-and-start acceptance passed** through the production `applyServer` path on the existing `server` project (`ams-e7615640ba`), with administrator prompts and handoff configured to fail if called. Application completed without them. Preparation rebuilt the changed runtime image as `sha256:abbb0e62ddfe241283878dfeaa8f9e1723f59918da73b8223eb6a0d403839708`; the five application images retained the identities listed below. Podman **6.1.1**, podman-compose **1.6.0**, **linux/arm64**: all seven long-running containers were running, all six health-checked containers were healthy, and bootstrap check exited **0**. The temporary config job succeeded and was removed. No administrator initialization or repair was requested. Integration readiness reported no pending peers; the published ports remained **127.0.0.1:8096** and **127.0.0.1:8123**.

The sanitized observation and all image identities are recorded in `artifacts/existing-stack-start.json`. This verifies rebuilding and starting the existing stack; comprehensive provider, agent, memory, Wiki, and MCP validation remains deferred.

### Simplified setup — completed 2026-09-16

Node.js 24.18.1: **160 tests passed**, **15 opt-in tests skipped**, **0 failed**; TypeScript checking passed. Setup no longer asks for services, stack addresses, ports, interface enablement, or Core/CLIProxyAPI service keys. Local service keys are generated when missing and reused automatically. Coverage includes engine-based reservations, sanitized binding conflicts, bounded retries, generated-origin provenance, custom-origin preservation, previous applied settings, and image build-input freshness.

The reported `Compose run (config)` exit 1 used an old runtime image whose field definitions lacked `KNOWLEDGE_TOOLS_PUBLIC_ENABLED`. Preparation had checked immutable IDs/platform only. It now also checks per-image build-input labels and rebuilds outdated images before stopping services. The real preparation path rebuilt the six stale images, then a second read-only preparation reused all six current identities without a build. Fingerprints exclude installation secrets/data and preserve reuse of matching imported images.

The first Panel build ended with exit 137 (`Killed`) while another Apply was running on the 2 GiB engine. A serialized rebuild after the services had stopped completed. The existing `server` installation was then resumed through the runtime lifecycle with its saved settings and data. No administrator initialization/repair or key replacement was performed; the existing Core initialization check remained mandatory.

**Build-and-start acceptance passed** on Podman **6.1.1**, podman-compose **1.6.0**, **linux/arm64**. At the recorded observation, Core, Knowledge, Panel, MemoryProxy, access, and knowledge-service were running and healthy; CLIProxyAPI was running. The temporary config job returned successfully and was removed; bootstrap check exited **0**. Integration readiness reported no pending peers. Only **127.0.0.1:8096** and **127.0.0.1:8123** were published. Knowledge HTTP port 8422 was removed from this installation; its protected gateway remains internal. Port reservations were cleaned up.

| Image | Immutable content ID (linux/arm64) |
| --- | --- |
| core | `sha256:9270ceda248f058bd395d92cf61969bbaa40f3f3d3125a12e2fc9b4a369665ad` |
| knowledge | `sha256:5be70b87ee53ca6b1f65aed1102d0b31faa442d4e327ab95ffb75cfdbe0522d8` |
| panel | `sha256:ff1609b638ac220c01379e0c409a304c5ee642a699aa54011eb782415ad9f5c9` |
| memory-proxy | `sha256:a979121c1d6702d29df9540913c14a45433b2df39666ec8cd841f73b4e3d4da7` |
| cli-proxy-api | `sha256:7f06a3f62e9c455e448d426ae1cf9d6df171ed34eac57be071ba025e90cebe54` |
| runtime | `sha256:68d0998067fa6ca9db4886a9923bfcbdb94416c2ab7f9c7390a67bc025a651cd` |

The local observation is recorded in `artifacts/simplify-start.json`. This is build/start evidence, not comprehensive agent, provider, semantic-memory, Wiki, or MCP validation. MCP and the connection-information menu remain separate unimplemented changes.

### Earlier menu cleanup

After removing the previous connection-information implementation, Node.js 24.18.1: **147 tests passed**, **15 opt-in tests skipped**, **0 failed**. The CLI keeps an explicit Configure stack menu before entering setup. The connection-information module, routing, and related tests have been removed. Compilation cleaned stale generated modules. These checks are maintenance evidence, not additional delivery acceptance criteria. No containers or saved user configuration were changed. Historical suite counts below describe their recorded snapshots.

## Compose provider precheck

The local `podman compose version` returned exit 125 because it could not find an external Compose provider. `uvx podman-compose version` succeeded with podman-compose 1.6.0. Application now checks that command before administrator prompts and image preparation, with a provider-specific diagnostic. **156 tests passed**, **15 skipped**; the real provider check passed without starting containers. All six images from the interrupted build were verified by immutable identity/platform and restored to the installation's image records for reuse. This recovery did not apply the user's services.

## Save-first and named apply commands

- Node.js 24.18.1: **152 tests passed**, **15 opt-in tests skipped** in the recorded suite snapshot. Server coverage includes remembered installation location, command parsing, working-directory independence, save-only behavior, immediate/deferred application, edited config regeneration, ephemeral administrator keys, failed apply retries, and preservation of exact previous applied settings.
- Real TTY server setup: CLIProxyAPI-only configuration was saved before **Apply configuration now?**, with **Yes** selected. Choosing **No** exited successfully and created no runtime Compose files or containers.
- Real `ams apply server`, launched from a different working directory, resolved that saved installation and reused existing CLIProxyAPI/runtime images on Podman Linux ARM64. It started the isolated service. After editing `.env`, a second application regenerated the config, recreated the application container, and preserved the previous applied inputs. The test used an isolated XDG directory linked to the existing Podman connection settings plus temporary uv cache/tool directories; its initial environment-only failures occurred before container startup.
- Test containers, networks and temporary files were removed. This follow-up did not rebuild images or test fresh Core initialization, real provider authorization, VPS access, or semantic memory; earlier results below retain their original scope.

## Automatic image preparation follow-up

- The Node.js 24.18.1 suite passes **131 tests**, with **15 opt-in tests skipped**. Added coverage verifies fresh setup without image metadata, selected-image builds, immutable image reuse, malformed/platform-mismatched records, engine failures, unchanged installed configuration on failure/cancellation, snapshot ordering, and no preparation replay after Escape.
- A real TTY run selected CLIProxyAPI alone and reached deployment approval without asking for a manifest. Declining approval exited without installation writes.
- A read-only check against the actual Podman Linux ARM64 engine reused the recorded CLIProxyAPI and runtime images. The temporary installation's manifest bytes stayed unchanged; no image was built and no container was started.
- The new automatic build-to-start path was tested with injected build/runtime dependencies. A fresh real source build and deployment through this revised wizard were not run; earlier runtime evidence below does not establish that new end-to-end path.

## 1. Environment and evidence boundary

| Component | Verified environment |
| --- | --- |
| Host | macOS 27.0 ARM64 |
| CLI acceptance | Node.js 24.18.1 |
| Container engine | Podman 6.1.1, Linux ARM64, VM with 8 CPUs and 2 GiB RAM |
| Compose provider | podman-compose 1.6.0 through `uvx` |
| Runtime base | Node.js 24; immutable base identities in `upstream.lock.json` and Dockerfiles |

Docker Compose and Linux AMD64 are supported configuration targets; execution on them has not been established by these local results. Build and deployment platform checks are separate from actual runtime acceptance.

Both changes were synchronized to the main specifications and archived on 2026-09-16. `select-deployment-services` replaces the fixed topology with selected services and explicit remote dependencies. Results from the earlier `containerize-agent-memory-stack` implementation remain useful regression evidence but do not certify newly generated subset/split deployments or refreshed archives. Their acceptance scope is build and container startup. Real agent/tool behavior, semantic memory/Wiki, and complete cold recovery are deferred to the comprehensive validation phase after Supergateway; no functional pass is implied.

## 2. Current service-selection checks

| Check | Recorded result |
| --- | --- |
| Strict TypeScript and compilation | Passed; emitted Compose preserves types in both YAML 1.1 and YAML 1.2 |
| Ordinary test suite | **91 passed**, with image-dependent suites run separately |
| UI and Clack adapter tests | **18/18 passed** on Node.js 24.18.1 |
| Real TTY selection/cancel | Passed: all five initially checked; Space/arrows selected CLIProxyAPI alone; only its applicable setup action appeared; Ctrl-C exited without apply |
| Relevant prompts and visible defaults | Covered: standalone CLIProxyAPI, required remote Core/model credentials, Knowledge callback owner, ports before origins, saved origins and separate local credentials |
| Reviewed apply and cancellation | Covered: additions/removals, redacted settings, declined staged start, snapshot after handoff and before replacing settings |
| Deployment model/config tests | **12/12 passed**, including the non-empty service-selection matrix and malformed settings |
| Actual consuming configuration loaders | **8/8 passed** for representative full/subset generated configurations |
| Authenticated Knowledge service and pairing | Missing/wrong/duplicate credentials, tenant mismatch, fixed routes, 300 KiB upload, body limits, unavailable peers, and wrong Core/Knowledge tuple passed |
| Patched callback sender/receiver | Authenticated completion/progress and Core entity synchronization preserve creator/team/summary; unauthorized or mismatched callbacks rejected before writes |
| Disabled Knowledge consumers | Patched Proxy renderer/injectors and Panel routes/navigation/onboarding checked; actual pinned Panel frontend typecheck passed |
| Configuration snapshot | Exact prior bytes and 0600 files/0700 directories; failed retry keeps the original snapshot; application/OAuth data excluded; redirected files rejected |
| Full local lifecycle | **Passed in 112 seconds**: nine selected/helper definitions, three loopback listeners, authenticated boundaries, existing administrator after recreation and cold credential restore |
| Full local model/L0 | **Passed in 65 seconds**: actual Proxy, Core and Panel; final tool instructions, unlisted model, no task header, USER/ASSISTANT L0, Chat and Responses SSE cancellation |
| Standalone CLIProxyAPI | **Passed in 4 seconds**: exactly two required images, one persistent application container, authenticated model API and disabled management |
| Bundle negative checks | Damaged checksums and a checksum-valid archive missing its declared image identity were rejected before loading |

The placement suite passed **2/2 in 233 seconds**. Its two Compose projects emulate private cross-machine routing by attaching peer containers with explicit aliases to the consuming project's network. Production probes run inside that network. This is local split-network evidence, not a test of two VPS hosts or Caddy.

It verified staged Knowledge startup blocks Wiki before Panel is available; authenticated forward/reverse pairing then succeeds; the exact shipped callback function, invoked with synthetic completion, updates Core with the creator preserved; the advertised user/tool endpoint returns tools; final model instructions, USER/ASSISTANT L0 and SSE cancellation work across projects. Wrong credentials, service identity, routes and mismatched pairings are rejected. Switching a frontend Core from local to a remote replacement and back reuses the local administrator and service identity, retains independent keys, and leaves the other project's Core running. Only one local CLIProxyAPI container remains. Cleanup leaves the existing `tdai-proxy` untouched.

All **10 actual loader/outgoing-client checks** were rerun against the final image identities: eight selected/full configuration loaders and two real Core/Knowledge HTTP clients passed. The callbacks use synthetic completion; real Wiki ingestion and real-provider access retain their separate acceptance below.

Reproduce the unit and focused configuration checks with Node.js 24+:

```sh
npm ci
npm run build
npm run typecheck
node --test tests/setup.test.mjs tests/interaction.test.mjs
npm test
```

The renderer uses `yaml` 2.9.1 with YAML 1.1 compatibility. Structural tests parse every one of the 31 non-empty selections under both YAML versions; schema/manifest checks and engine execution remain distinct checks. Run image-dependent suites only with a manifest containing the rebuilt application/runtime identities required by those suites. Current ordinary tests pass 91 cases; 15 image-dependent cases are opt-in and were also run successfully.

Reproduce the image-dependent checks serially, using the same native engine that built/loaded the bundle:

```sh
export AMS_IMAGE_MANIFEST="$PWD/artifacts/images-selection/images.json"
export AMS_CONTAINER_ENGINE=podman AMS_COMPOSE_PROVIDER=uvx-podman-compose
AMS_IMAGE_LOAD_TEST=1 node --test tests/build.test.mjs
AMS_UPSTREAM_CONFIG_TEST=1 AMS_UPSTREAM_LLM_TEST=1 node --test --test-concurrency=1 tests/upstream-config.test.mjs tests/upstream-llm.test.mjs
AMS_RUNTIME_SMOKE=1 node --test tests/runtime-smoke.test.mjs
AMS_MODEL_SMOKE=1 node --test tests/model-smoke.test.mjs
AMS_PLACEMENT_SMOKE=1 node --test tests/placement-smoke.test.mjs
```

Loader/client suites resolve this distribution's local image tags and print the inspected content IDs. Lifecycle/placement suites consume `AMS_IMAGE_MANIFEST`. The pinned-source patch test is `node dist/patches/test.js /path/to/pristine/pinned/tencent`; it does not modify that source tree.

Two runtime defects were found and fixed during current acceptance: YAML 1.1 interpreted an unquoted `restart: no` as a boolean, and Panel's TypeScript build did not copy the shared JavaScript identity helper. The renderer now quotes compatibility-sensitive scalars. The Panel image build explicitly copies the helper and imports the compiled application dependency graph before succeeding.

### Final local delivery

The final bundle is [artifacts/images-selection](artifacts/images-selection). Its Docker archive is **1,642,331,648 bytes**. Export and actual load both verified all six content identities on the local Linux ARM64 engine; load reused existing layers, so this does not claim an empty VPS installation.

- Archive SHA-256: `aee1f4fde47d2aa3162eec1a7b4ade6148483d5c8c2a140c19d911351cbbeaff`
- Manifest SHA-256: `795d6cae494a70771e9b700c5afca6e97e928801959beb4d35e53afaa818c21a`

| Image | Immutable content ID (linux/arm64) |
| --- | --- |
| memory-proxy | `sha256:d41f060193cb3311c47bdf2828316554570e06e057c08c38955ecebd949ca2ec` |
| core | `sha256:2c9c3dd9c1d2f771bc9f1f91936b1723dcb8971ba947a1f89fb04d4c5bb00077` |
| knowledge | `sha256:6b685ff6f191a849442ffe15bedb775a781e02b03ed0f9caabccfac37f3b64a3` |
| panel | `sha256:5a074f1f3e8091c5fd8ab2160fc4442df3ead9d7a222ffbc3d59322fa28edeb4` |
| cli-proxy-api | `sha256:909c9bd136374a55dd5d14915a385a543b330bd228dd06062d5849aff6840abe` |
| runtime | `sha256:bc3321878732d05c8cf5db1f7dbb0afbc5abb7e231a7540239b7517e8f21fa70` |

The npm artifact is `artifacts/agent-memory-stack-0.1.0.tgz`. Isolated installation checks exercise installed CLI help, full and CLI-only setup/rendering, YAML 1.1 restart strings, packaged source patches and idempotence, and the exclusion of secret-bearing state. The package checksum and installed-package checks are recorded in `artifacts/package-validation.json`.

## 3. Earlier full-stack regression evidence

The earlier fixed-stack acceptance recorded **58 passing ordinary tests** and **8 separately passing opt-in integration tests**. Those counts describe that earlier source version, not the current expanded suite.

| Check | Earlier recorded result |
| --- | --- |
| Exact `.env` and preload values | Quotes, backslashes, and literal `$` preserved |
| Actual Core/Knowledge/Proxy/Panel config loaders | 4/4 passed with networking disabled |
| Actual Core/Knowledge LLM clients → HTTP fixture | 2/2 passed: exact API prefix/Bearer, separate models/token limits, one accepted request each |
| Administrator lifecycle | Generated/custom key, transient stdin, inactive user, conflict, repair, and ordinary existing-state checks passed |
| User/session/tool authorization | Active users/members, asset ACL, stolen sessions, and route allowlists covered |
| Patched request/stream paths | Model instructions, literal key references, credit disabled, streaming/cancellation covered with synthetic upstream |
| npm pack/install | Isolated installation resolved packaged assets without the checkout |
| Six ARM64 images and image bundle | Build, export, load, integrity/platform verification passed |
| Actual MemoryProxy entrypoint | HTTP 200, working SQLite, clean SIGTERM exit |
| Full Compose recreation and cold credential restore | Passed in 114 seconds; three loopback listeners and stable administrator identity |
| UID 10001 persistence | Marker writes/readback after container replacement passed for Core, Knowledge, Panel, Proxy, and CLIProxyAPI auth directory; file mode `0600` |
| Actual Proxy → synthetic model, Core, and Panel | HTTP-origin run passed in approximately 61 seconds, including final instructions and USER/ASSISTANT L0 |

These checks found and corrected concrete upstream integration problems: Panel expects `{instances:[...]}` and an externally usable Proxy endpoint; Proxy appends its own auth verification path to the Core origin; Responses uses `session-id` while Chat uses `x-conversation-id`; podman-compose `ps` does not accept a service argument; and the old Proxy Node guard excluded Node 24.

Podman 6.1.1 native `--requires` could restart completed setup containers. Managed startup therefore uses explicit `up --no-deps` and checks its readiness stages. Proxy/Knowledge use pinned `better-sqlite3` 13.0.3: the old Proxy version crashed in 6/20 Node 24/native/tsx shutdown runs, while the replacement passed 20 repeated shutdowns and actual server startup.

### Lifecycle and synthetic model smoke boundaries

The lifecycle smoke uses its own Compose project and data, with loopback ports `18096`, `18422`, and `18123`. It tests startup, internal-route denial, absence of the transient admin key in logs, stable administrator identity after recreation, and cold credential restore into an isolated Core database. Its synthetic LLM address is intentionally unavailable; it does not establish model or Wiki behavior.

The model smoke uses separate ports `19096`, `19422`, and `19123`, with an HTTP upstream inside its own container network. Actual Proxy/Hono, Core, and Panel preserve USER/ASSISTANT L0. It verifies the final model request contains `<knowledge_tools>`, the intended external tool origin, and literal `${AMS_USER_KEY}` without the admin key. A model outside the sample price list and a request without `x-task-id` succeed. Responses SSE, Chat completions, and upstream cancellation without a duplicate request are covered.

The Wiki asset in that model test contains metadata only. It does not demonstrate document ingestion, semantic recall, real-provider authorization, or a real agent executing the generated tools.

Run heavy integration suites serially on the 2 GiB VM. A repeated test must clean up only its own project and preserve unrelated user containers. Generated Compose support for a new topology does not make an earlier successful smoke run evidence for that topology.

### Historical resource snapshot

On empty application data, with healthy services and no authorized model account, the earlier full-stack run reported approximately **916 MB** total in `podman stats`. This is a container memory-accounting snapshot, not peak RAM under load or a VPS sizing recommendation.

| Service | Memory usage |
| --- | --- |
| Core | 533.3 MB |
| Knowledge | 143.4 MB |
| Panel | 38.2 MB |
| MemoryProxy and tool access adapter | 160.8 MB |
| CLIProxyAPI | 39.8 MB |

The earlier six-image archive was approximately **1.5 GiB**. The additional Knowledge service adapter and current integration checks require a new resource measurement if sizing the revised topology. Peak Wiki ingestion memory, database growth, and real-session disk use remain unmeasured.

## 4. Deferred comprehensive validation after Supergateway

1. **VPS and agent route:** confirm target architecture, package/image installation, TLS if enabled, cookies/redirects, SSE, and cancellation through the operator's actual reverse proxy. Agent-specific WebSocket behavior requires separate runtime validation.
2. **Provider access:** supply a working model API base/key and available models; complete ChatGPT device approval, make a real model request, and verify server-side OAuth refresh with one refresher.
3. **Real agent and tools:** verify new/resumed sessions, final model-visible injection, and execution of the tool command from that agent's actual environment. Synthetic L0/injection evidence does not establish real-agent behavior.
4. **L1/L2/L3 and Wiki:** submit a unique engineering fact, observe extraction within a bounded interval, recall it in another authorized session, test allowed cross-agent/member access and denial to outsiders, and perform real Wiki ingestion/read. HTTP 200, a finished job, or health alone does not prove the content is usable.
5. **Full recovery:** restore a reference conversation and Wiki together with the original administrator identity and compatible image/data versions. Confirm one OAuth refresher and recheck access after VM/host restart; measure resources under real load.

For semantic acceptance, use a unique test-project fact with a verifiable value. Locate it first in the source conversation, then in Atomic Memory, then in another authorized session's context. For L2/L3, record the actual pipeline trigger conditions and observable outputs rather than expecting every level after one message.

These scenarios are reserved for the later comprehensive validation phase and are outside the acceptance scope of the archived changes. Configuration snapshots preserve settings for retry/rollback; they do not replace cold backups of conversation, Wiki, credentials, or OAuth state. This evidence boundary retains the deployment lessons recorded in `tdai-recap.md`.
