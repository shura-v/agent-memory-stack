> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## Purpose

Run a selected TDAI revision unchanged, with native configuration and an external AMS transport boundary rather than a locally maintained application fork.

## ADDED Requirements

### Requirement: Unmodified TDAI delivery

AMS MUST preserve the selected TDAI source files, dependency manifests and supplied locks. It SHALL NOT patch application behavior, inject modules/preloads, rewrite dependencies, or repair upstream bugs through startup or build transformations. Normal compilation and dependency installation SHALL use upstream inputs. Source provenance and output image identities SHALL remain verifiable.

#### Scenario: Prepare the selected source
- **WHEN** AMS downloads, unpacks and stages TDAI for building
- **THEN** its source files, manifests and locks match the verified source archive
- **AND** no AMS source patch or injected runtime module is added to the TDAI application

#### Scenario: Upstream behavior prevents an operation
- **WHEN** the selected unmodified TDAI revision fails to build, start or perform an operation
- **THEN** AMS reports the observed failure and revision without claiming success
- **AND** it does not repair the application or silently weaken a configured credential to bypass that failure

### Requirement: Flat native configuration acquired from upstream

AMS SHALL obtain native templates from the selected verified TDAI source and place the five native files directly in the recorded configuration root's `defaults/`. Operator changes MAY reside in either visible set; `overrides/` remains the stable way to retain changes across a TDAI update. The default root SHALL be `~/.config/agent-memory-stack`, with the existing absolute XDG root option. Source revision SHALL remain in runtime `.ams/tdai-source.json`, not a configuration subdirectory. Runtime `.ams/native-config.json` SHALL store only the native root and initial-origin finalization. AMS SHALL create no `.ams-state.json`, persisted template manifest, default checksum index or runtime owner marker. The repository and npm package SHALL contain no vendored TDAI template set. Initial acquisition SHALL support a verified archive from download, cache or offline delivery.

#### Scenario: First configuration
- **WHEN** Configure creates a fresh installation
- **THEN** defaults contains `core.yaml`, `proxy.yaml`, `knowledge.env`, `panel.env` and `panel-instances.json` directly, with original selected-source contents
- **AND** known installation settings are saved separately in overrides without a revision-named directory

#### Scenario: Update TDAI
- **WHEN** an explicit update activates another verified revision
- **THEN** AMS replaces defaults with that revision's original files and preserves user override bytes
- **AND** it creates no revision-indexed template directory or third editable settings set

#### Scenario: Source acquisition fails
- **WHEN** required source templates cannot be obtained or fail integrity checks
- **THEN** acquisition fails with the existing configuration and running deployment preserved
- **AND** packaged copies or a different revision are not silently substituted

#### Scenario: First configuration shares a directory with unrelated files
- **WHEN** the selected root contains unrelated files but no defaults or overrides
- **THEN** Configure creates the native configuration and records its runtime association
- **AND** the unrelated files remain unchanged

#### Scenario: Reuse native configuration after its runtime reference is lost
- **WHEN** the selected native root has a complete composable configuration but its saved runtime reference is missing
- **THEN** AMS reads the existing native files and preserves defaults, overrides and credentials without reseeding
- **AND** Configure or Apply recreates the reference during normal configuration saving
- **AND** incomplete or malformed native documents remain an error

#### Scenario: Apply edited defaults
- **WHEN** the operator edits a parseable document in `defaults/` and runs ordinary Apply
- **THEN** AMS composes and applies those bytes without restoring the downloaded template
- **AND** a later explicit TDAI update replaces all five defaults and preserves overrides

### Requirement: Native configuration semantics

TDAI SHALL receive composed configuration through its native files, environment variables and supported entry arguments. AMS SHALL NOT add a private parsing language, rewrite application loaders, or promise semantics different from the selected upstream parser. Configure SHALL collect settings and model choices. Apply SHALL use saved files without model questions, discovery, required-value enforcement or automatic model replacement. All configured values, including AMS values and native defaults, SHALL remain operator-owned; document structure, concurrent-edit and filesystem integrity checks SHALL remain distinct from value validation.

#### Scenario: Apply an intentionally empty model
- **WHEN** the operator saves an empty model or another custom native or AMS value
- **THEN** Apply passes the saved configuration through without asking for or replacing that value
- **AND** any subsequent service rejection is reported as an execution result

#### Scenario: Native interpolation
- **WHEN** a saved value has special meaning to the stock YAML or dotenv loader
- **THEN** the stock loader determines its runtime meaning
- **AND** AMS does not inject code or derived overrides to correct that meaning

### Requirement: Stock stdio MCP through the AMS gateway

The retained AMS `/mcp` endpoint SHALL expose the selected TDAI stdio MCP's tools, schemas and results through an external stateless Streamable HTTP transport. AMS SHALL execute an unchanged upstream MCP artifact with native settings and SHALL remove its replacement tool implementation. The external bridge SHALL supply the required service header without modifying TDAI, preserve caller isolation, and enforce existing AMS user/team/resource permissions before forwarding resource requests. It SHALL NOT retry under elevated credentials or expose unsupported administrative routes. Tool compatibility SHALL be established for the selected source, not assumed across revisions.

#### Scenario: List and call native tools
- **WHEN** an authenticated user initializes MCP and invokes an allowed stock tool through independent HTTP POST requests
- **THEN** the tool list and schemas come from the running stock stdio server
- **AND** the request reaches stock Knowledge with the required service header and returns the native result

#### Scenario: Connect HTTP to stdio without dependency patches
- **WHEN** AMS accepts an authenticated MCP POST
- **THEN** the official SDK stateless HTTP and stdio transports relay messages directly to a new isolated unchanged TDAI child for that request
- **AND** the response completing, aborting or failing closes that child and its transports without a persistent session, pool or idle expiry policy
- **AND** third-party source metadata resides under vendor and AMS Dockerfiles remain under deploy
- **AND** AMS and its MCP gateway share the root package.json and package-lock.json

#### Scenario: Resource access is denied
- **WHEN** a caller requests an inaccessible resource or uses an invalid or revoked credential
- **THEN** the AMS boundary rejects the request without forwarding a privileged substitute

#### Scenario: Unsupported native route appears
- **WHEN** a new upstream tool targets a route not supported by the external access boundary
- **THEN** AMS reports that incompatibility without rewriting TDAI or opening arbitrary forwarding
