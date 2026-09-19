> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## Purpose

Give operators the complete native TDAI configuration surface through visible upstream defaults and persistent overrides, with explicit precedence and coherent version updates.

## ADDED Requirements

### Requirement: Revision-matched native template sources

AMS SHALL provide all five complete native template documents from one verified upstream revision: Core gateway YAML, MemoryProxy configuration YAML, Knowledge environment template, and Panel environment template plus instance-registry JSON. AMS SHALL acquire templates from a verified downloaded or cached source archive. Offline bundles SHALL supply the verified source archive with its revision and content hash. The repository and npm package SHALL contain no TDAI template copies. Distributable source metadata and templates SHALL contain no installation secrets or user data. Missing or unverifiable templates SHALL prevent configuration activation instead of substituting templates from another revision. The entire defaults set SHALL advance to one selected revision together.

#### Scenario: Initialize from an installed npm package
- **WHEN** a fresh installation uses the package's pinned TDAI revision
- **THEN** all five complete native templates are extracted from the verified selected source without a developer checkout
- **AND** each document retains its native configuration format

#### Scenario: Apply a verified offline update
- **WHEN** an offline bundle supplies the selected TDAI images and verified source archive
- **THEN** AMS verifies the source archive and extracts its complete templates without downloading sources
- **AND** a missing or mismatched template prevents activation

### Requirement: Separate native configuration and runtime roots

The default native configuration root SHALL be `$XDG_CONFIG_HOME/agent-memory-stack` when an absolute XDG configuration home is configured, otherwise `~/.config/agent-memory-stack`. An invalid relative XDG configuration home SHALL produce actionable guidance before writing configuration. Runtime `.ams/native-config.json` SHALL support `version`, absolute `root`, and boolean `originsFinalized`; additional fields SHALL be ignored. When that reference is missing, AMS SHALL reuse complete composable defaults and overrides from the selected root, treat their origins as operator-owned, and recreate the reference during normal Configure or Apply saving with `originsFinalized` set to true. Incomplete or malformed native documents SHALL remain errors. Unrelated files such as `targets.json` and `.ams-state.json` SHALL be preserved and ignored and SHALL not prevent first setup. The runtime working directory SHALL remain its fixed location, `~/.agent-memory-stack`; native setup and updates SHALL preserve Compose project identity, application data locations, OAuth state, and existing credentials. A saved explicit native root SHALL remain authoritative across invocations and changes of working directory. Override files, composed runtime files, and snapshots containing secrets SHALL use restricted permissions. AMS SHALL create no `.ams-state.json`, native-root owner, template manifest, or checksum metadata.

#### Scenario: Fresh configuration with XDG_CONFIG_HOME
- **WHEN** the operator saves a new installation with an absolute XDG_CONFIG_HOME
- **THEN** visible defaults/ and overrides/ directories are saved under its agent-memory-stack directory
- **AND** the runtime location is recorded separately without moving data into the configuration root

#### Scenario: Reapply a native installation
- **WHEN** the operator applies saved native configuration
- **THEN** its runtime directory, Compose identity, data mounts, OAuth files, and credentials remain in use
- **AND** the saved native configuration root remains linked to the same installation

#### Scenario: Runtime reference is missing
- **WHEN** the selected native root has complete composable defaults and overrides and its `.ams/native-config.json` reference is missing
- **THEN** Configure and Apply reuse its existing defaults, overrides and credentials without initial reseeding
- **AND** normal configuration saving recreates the runtime reference with finalized operator-owned origins

#### Scenario: Native root contains incomplete configuration
- **WHEN** a selected root contains incomplete or malformed defaults or overrides
- **THEN** AMS reports the structural error without overwriting those files

#### Scenario: Ignore unrelated state-shaped files and metadata fields
- **WHEN** the selected root contains `.ams-state.json` or `.ams/native-config.json` contains additional fields
- **THEN** AMS ignores those unrelated fields and files while using the supported runtime reference fields

### Requirement: Visible defaults and persistent native overrides

The native root SHALL expose two authoritative operator-owned sets: `defaults/` containing complete native documents initially copied from the selected upstream templates, and `overrides/` containing partial native-format documents. AMS SHALL initially populate overrides only with known installation values, required container adaptations, and persistent generated service credentials. A missing override document SHALL mean full inheritance. Ordinary Configure and Apply SHALL preserve direct edits in either set. An explicit TDAI update SHALL replace all five defaults from its verified archive while preserving override bytes, comments, literal secret values and deletion declarations. An explicit wizard change SHALL write only its confirmed fields to overrides and preserve unrelated settings. Model choices SHALL belong to Configure stack; first allocation of missing derived local origins SHALL follow its explicit setup contract. All five native documents SHALL be initialized together for the complete local stack. Existing complete sets SHALL distinguish initialized configuration from first setup even when the runtime reference is missing; ordinary apply SHALL NOT repopulate a deliberately removed overlay. Non-secret initial-origin state in the runtime reference SHALL keep generated origins synchronized through initial startup retries and record finalization after successful activation. AMS SHALL NOT retain a native-root state file, template manifest, checksum index, runtime owner, separate populated baseline, private seed of service values, or third editable set of resolved values. Orchestration `.env` SHALL own AMS deployment choices; composed native documents SHALL own TDAI service settings. CLIProxyAPI and AMS helpers SHALL retain their existing configuration lifecycle.

#### Scenario: Inspect the two sets
- **WHEN** an operator opens the native configuration root
- **THEN** defaults/ shows the complete operator-owned documents initially copied from the selected upstream revision
- **AND** overrides/ shows AMS's initial values and the operator's subsequent changes separately

#### Scenario: Preserve an advanced native option
- **WHEN** an operator adds a supported option absent from the wizard or upstream template to overrides
- **THEN** apply retains and supplies it to the service without requiring an AMS field allowlist

#### Scenario: Change one wizard answer
- **WHEN** an operator explicitly confirms a different model or connection in setup
- **THEN** setup changes the corresponding override fields and preserves unrelated overrides
- **AND** subsequent ordinary apply does not restore an earlier wizard answer

#### Scenario: Finalize a fresh local origin
- **WHEN** first application allocates a published port and its derived local origin override is still missing or unset
- **THEN** setup uses the resolved origin for each attempt and records finalization only after successful activation, without a URL prompt
- **AND** an already supplied origin remains authoritative

### Requirement: Deterministic native overlay and explicit deletion

AMS SHALL compose each native document as defaults plus overrides. Mappings present in both documents SHALL merge recursively; an empty mapping SHALL supply no child overrides. When types differ the explicit override type SHALL win. Scalar values and explicit YAML/JSON null SHALL replace the default exactly; arrays SHALL replace the whole default array. An absent override field SHALL inherit its default. Environment documents SHALL merge by variable name and preserve exact supported literal values; an empty assigned value SHALL be an explicit override, not deletion. Native expansion semantics SHALL remain those of the consuming service.

Explicit removal SHALL use `overrides/deletions.json`, mapping native document filenames to arrays of JSON Pointer paths. Each pointer SHALL identify an object field or environment variable; deleting an array SHALL remove the whole field and array-element pointers SHALL be rejected. Absent targets SHALL be no-ops so the same deletion can survive an upstream update. Invalid pointers, root deletion, unknown document filenames, and an assignment and deletion targeting the same path or overlapping ancestor/descendant paths SHALL fail with file/path guidance. A mapping containing unrelated child overrides SHALL NOT count as an assignment to its ancestor: overriding llm.model and deleting llm.timeoutMs SHALL be permitted together. Deletion metadata SHALL never be passed to an upstream service. Removing an assignment or deletion from overrides SHALL restore inheritance from defaults at that location. Unknown native override fields SHALL NOT be rejected solely because the AMS wizard or default template does not list them.

#### Scenario: Override a nested field and a list
- **WHEN** overrides supplies one nested scalar and an array
- **THEN** unrelated default object fields remain present and the supplied array replaces the whole default array

#### Scenario: Inherit after removing an override
- **WHEN** the operator removes an override field without adding a deletion for it
- **THEN** the next composition uses the selected revision's default at that path

#### Scenario: Distinguish null empty and deletion
- **WHEN** an override sets a YAML/JSON field to null or an environment variable to an empty value
- **THEN** the explicit value reaches the effective document without an AMS semantic check
- **AND** only a separate deletion pointer removes a default field

#### Scenario: Delete a default field across updates
- **WHEN** deletions.json names a field present in one revision and absent in the next
- **THEN** that field is absent from both effective configurations and the missing target does not block update

#### Scenario: Reject ambiguous or array-element deletion
- **WHEN** deletion metadata overlaps an assigned override path or addresses an individual array element
- **THEN** validation identifies the conflicting document and path before activation
- **AND** the operator can replace or delete the whole array field instead

### Requirement: New-template upgrades retain explicit override priority

Every TDAI version update SHALL stage all five original templates from the new revision and compose them with the same byte-preserved overrides and deletion metadata. A setting without an override SHALL adopt the new default. An override SHALL win even if upstream changed the corresponding default or type. Update SHALL NOT use three-way merge, classify overrides by comparison with a populated baseline, automatically relocate renamed settings, or require user choices merely because both defaults and overrides changed the same field. Persistent secrets SHALL remain exact unless explicitly changed by the operator.

AMS SHALL report redacted paths removed from defaults or changed in default type when they are touched by overrides. Such diagnostics SHALL NOT claim exhaustive schema compatibility or automatically reject an effective value accepted by the native loader. Parsing errors and invalid overlay/deletion instructions SHALL block composition with actionable file/path guidance. All five documents SHALL be composed and structurally checked together on every apply and update. AMS SHALL NOT reject native values based on ports, paths, URLs, prefixes, models, credentials or connection equality. Native loaders and runtime checks MAY reject values or fail after activation; operators SHALL retain their desired overrides for correction and retry.

#### Scenario: Adopt a new default
- **WHEN** the new template changes a field absent from overrides
- **THEN** the effective configuration uses the new default
- **AND** unrelated overrides remain unchanged

#### Scenario: Keep an override despite a changed default
- **WHEN** the new template changes a default that has an explicit override
- **THEN** the same override remains effective and its source file is unchanged

#### Scenario: Preserve a valid override after an upstream type change
- **WHEN** a default changes type and the operator has supplied an explicit override
- **THEN** update reports the affected path without secret values and accepts the override

#### Scenario: Resolve an incompatible effective configuration
- **WHEN** a changed template and existing overrides cause a service loading or runtime failure
- **THEN** the actual failing runtime stage is reported and the previous coherent configuration remains available for recovery
- **AND** the operator can edit overrides and retry without selecting a merge result or rotating credentials

### Requirement: Validate and activate coherent configuration versions

AMS SHALL check document syntax, overlay/deletion rules, runtime reference shape, selected source integrity and image integrity before replacing active configuration, image selection or running containers. It SHALL NOT validate configured values in native documents or AMS orchestration, including host ports, DATA_DIR, provider names, native connection fields or models. Structural failures SHALL leave the active generation unchanged and preserve desired edits. Semantic service acceptance SHALL belong to actual native loading and runtime execution; startup failures SHALL retain coherent recovery information rather than promising that activation never occurred. AMS SHALL check fingerprints of defaults, overrides, deletion metadata, and relevant orchestration inputs before activation; edits after candidate validation SHALL require preparing and validating a fresh candidate. Activation and snapshots SHALL keep both visible sets, deletion metadata, non-secret initial-origin state, root association, selected source/images, and persistent secrets as one recoverable configuration version. Recovery SHALL NOT claim application database rollback. Retry SHALL reuse existing secrets without reseeding or rotating credentials.

#### Scenario: Fail candidate validation
- **WHEN** a document has invalid syntax, an invalid deletion instruction or an invalid runtime reference
- **THEN** the error identifies its file and setting without disclosing secrets
- **AND** the running installation and active configuration remain unchanged

#### Scenario: Edit an input during preparation
- **WHEN** an operator changes overrides after a candidate was validated
- **THEN** activation detects the changed fingerprint and requires a fresh candidate using the current input
- **AND** the operator's edit is not replaced by stale prepared state

#### Scenario: Recover after activation failure
- **WHEN** activation fails after a coherent candidate has been prepared
- **THEN** the prior version remains recoverable with its matching defaults, overrides, deletion metadata, source/images, root association, initial-origin state, and secrets
- **AND** retry does not create new service credentials or administrator identities

### Requirement: Faithful native container consumption

Containers SHALL consume composed native documents through read-only mounts or faithful runtime copies using each service's native configuration interface. Knowledge and Panel SHALL receive composed native environment settings; Panel SHALL also receive its composed instance-registry JSON. Minimal container path, listener, and service-address adaptations SHALL be visible overrides. Any generated environment transport SHALL be derived only from the effective native documents and SHALL NOT form an independent third configuration layer. Native expansion and precedence semantics SHALL be preserved per service; AMS SHALL NOT assume that all YAML files interpolate environment placeholders or introduce shell evaluation of values. AMS SHALL preserve saved credential input; runtime interpolation and quoting SHALL follow each stock service parser. Generated effective documents SHALL be runtime artifacts, not another operator-maintained configuration set.

#### Scenario: Consume native env and YAML together
- **WHEN** a deployment includes Core, MemoryProxy, Knowledge, and Panel
- **THEN** each service receives defaults composed with its overrides in the supported native format
- **AND** generated environment transport supplies no competing native values

#### Scenario: Preserve a literal provider credential
- **WHEN** a supported credential contains dollar signs, quotes, or backslashes
- **THEN** AMS delivers the saved credential input without shell execution; stock parser rules determine runtime interpolation

### Requirement: Operator-owned optional Core service authentication

AMS SHALL NOT generate a Core service key or initially seed server.apiKey in overrides/core.yaml. The selected original template SHALL remain unchanged; an absent override SHALL inherit its native default. Core service authentication SHALL remain unset for the selected default configuration. Operator-supplied server.apiKey and native consumer credentials SHALL remain supported and SHALL NOT be silently cleared or rotated by Configure, Apply or updates. Core user-key verification, initial administrator identity and the independent MemoryProxy admin.apiKey SHALL retain their existing contracts.

When no Core service key is configured, initial setup SHALL retain the selected Proxy template's nonempty tdai.apiKey, skill.serviceToken and knowledge.serviceToken values and SHALL initialize the Panel instance api_key with the public value local. These native client fields SHALL satisfy stock token/registry requirements without being treated as Core service secrets or user credentials. Ordinary Apply SHALL preserve operator edits and SHALL NOT repopulate deliberately emptied client fields.

Documentation SHALL state that an empty Core server.apiKey disables its native service guard, including Core administration routes that have no separate user check. Core SHALL remain unpublished by default. Enabling a Core service key MAY break stock Proxy user verification when the selected Proxy omits its service Bearer header; AMS SHALL preserve that upstream behavior and the operator's value.

#### Scenario: Configure without a Core service key
- **WHEN** a new installation has no operator-supplied Core service credential
- **THEN** AMS does not generate or seed one and composes Core from the original template and operator overrides
- **AND** CLIProxyAPI, Proxy administration and Core administrator initialization keep their separate credential lifecycles

#### Scenario: Retain native client token fields without Core service authentication
- **WHEN** initial setup has no Core service key and uses the selected templates
- **THEN** Proxy inherits its native local token values and the Panel instance receives api_key local
- **AND** Core server.apiKey remains unset, and user-key verification retains its separate credential

#### Scenario: Preserve an operator-configured Core service key
- **WHEN** the operator sets server.apiKey or related native consumer credentials and runs Configure, Apply or a TDAI update
- **THEN** AMS preserves those explicit native values without silently clearing them or repairing upstream authentication

### Requirement: Persistent native MemoryProxy administrative authentication

Initial setup SHALL generate an independent MemoryProxy admin.apiKey from 32 random bytes when no value was supplied and persist it in overrides/proxy.yaml. It SHALL remain separate from Core service, CLIProxyAPI and Core administrator user credentials. After setup, AMS SHALL preserve operator-edited, removed or empty values without regenerating or validating them. Native TDAI SHALL determine which routes check admin.apiKey and the resulting authentication behavior. AMS SHALL not add a Proxy outer request guard, route allowlist or role replacement.

#### Scenario: Configure native administrative access
- **WHEN** initial setup creates MemoryProxy configuration without an administrative credential
- **THEN** it saves an independent nonempty administrative override with restricted permissions
- **AND** Apply and updates reuse that saved value

#### Scenario: Reach native instance administration
- **WHEN** a request reaches a stock route that checks admin.apiKey
- **THEN** the stock handler compares its configured native credential
- **AND** AMS does not claim this protection for routes that do not perform that check

#### Scenario: Administrative override disappears after provisioning
- **WHEN** an initialized installation has a missing, deleted or empty administrative override
- **THEN** composition follows ordinary inheritance or deletion without regenerating the key
- **AND** native TDAI determines the authentication result

### Requirement: Configuration check verifies composition integrity

Standalone configuration check SHALL load saved orchestration and the composed native configuration. It SHALL check syntax, overlay/deletion rules, reference shape and other structural integrity needed to read those files. It SHALL NOT validate configured value policies, compare defaults with upstream checksums, probe providers, discover models, generate values or claim runtime readiness.

#### Scenario: Check edited configuration without value enforcement
- **WHEN** parseable configuration contains custom ports, paths, URLs, prefixes, models, credentials or provider values
- **THEN** check composes it without enforcing AMS or TDAI semantic constraints
- **AND** syntax, deletion or reference failures still produce actionable structural errors
