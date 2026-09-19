## Purpose

Give operators the complete native TDAI configuration surface through visible upstream defaults and persistent overrides, with explicit precedence and coherent version updates.

## ADDED Requirements

### Requirement: Revision-matched native template sources

AMS SHALL provide all five complete native template documents from one verified upstream revision: Core gateway YAML, MemoryProxy configuration YAML, Knowledge environment template, and Panel environment template plus instance-registry JSON. Packaged initial templates and offline update bundles SHALL include the exact upstream revision, source paths, and content hashes. Distributable templates and provenance SHALL contain no installation secrets or user data. Missing or unverifiable templates SHALL prevent configuration activation instead of substituting templates from another revision. The entire defaults set SHALL advance to one selected revision together.

#### Scenario: Initialize from an installed npm package
- **WHEN** a fresh installation uses the package's pinned TDAI revision
- **THEN** all five complete native templates and their verified provenance are available without a developer checkout
- **AND** each document retains its native configuration format

#### Scenario: Apply a verified offline update
- **WHEN** an offline bundle supplies the selected TDAI images and native templates
- **THEN** AMS verifies their revision and template hashes and uses those templates without downloading sources
- **AND** a missing or mismatched template prevents activation

### Requirement: Separate native configuration and runtime roots

The default native configuration root SHALL be `$XDG_CONFIG_HOME/agent-memory-stack` when an absolute XDG configuration home is configured, otherwise `~/.config/agent-memory-stack`. An invalid relative XDG configuration home SHALL produce actionable guidance before writing configuration. AMS SHALL persist the association between this root and the runtime installation and reject an occupied unassociated root rather than adopting its state. The runtime working directory SHALL remain its fixed location, `~/.agent-memory-stack`; native setup and updates SHALL preserve Compose project identity, application data locations, OAuth state, and existing credentials. A saved explicit native root SHALL remain authoritative across invocations and changes of working directory. Override files, composed runtime files, and snapshots containing secrets SHALL use restricted permissions.

#### Scenario: Fresh configuration with XDG_CONFIG_HOME
- **WHEN** the operator saves a new installation with an absolute XDG_CONFIG_HOME
- **THEN** visible defaults/ and overrides/ directories are saved under its agent-memory-stack directory
- **AND** the runtime location is recorded separately without moving data into the configuration root

#### Scenario: Reapply a native installation
- **WHEN** the operator applies saved native configuration
- **THEN** its runtime directory, Compose identity, data mounts, OAuth files, and credentials remain in use
- **AND** the saved native configuration root remains linked to the same installation

### Requirement: Visible defaults and persistent native overrides

The native root SHALL expose two authoritative sets: `defaults/` containing exact complete upstream template bytes managed by AMS, and `overrides/` containing partial native-format documents that the operator can edit. AMS SHALL initially populate overrides only with known installation values, required container adaptations, and persistent generated service credentials. Defaults SHALL remain unpopulated upstream originals; changes belong in overrides. A direct change to defaults SHALL fail provenance validation with guidance to move the change to overrides. A missing override document SHALL mean full inheritance. After initial configuration, ordinary apply and TDAI update SHALL preserve override bytes, comments, and literal secret values and SHALL NOT reseed or automatically rewrite them. An explicit wizard change SHALL write only its confirmed fields to overrides and preserve unrelated settings. Model choices SHALL belong to Configure stack; first allocation of missing derived local origins SHALL follow its explicit setup contract. All five native documents SHALL be initialized together for the complete local stack. The saved native association SHALL distinguish an initialized installation from first setup; ordinary apply SHALL NOT repopulate a deliberately removed overlay. Non-secret initial-origin finalization state MAY support the deferred port-allocation contract. AMS SHALL NOT retain a separate populated baseline, private seed of service values, or third editable set of resolved values. Orchestration `.env` SHALL own AMS deployment choices; composed native documents SHALL own TDAI service settings. CLIProxyAPI and AMS helpers SHALL retain their existing configuration lifecycle.

#### Scenario: Inspect the two sets
- **WHEN** an operator opens the native configuration root
- **THEN** defaults/ shows complete unmodified templates for the selected upstream revision
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
- **THEN** setup records the resolved origin in overrides without a URL prompt
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

AMS SHALL check document syntax, overlay/deletion rules, matching source/template provenance, root ownership and image integrity before replacing active configuration, image selection or running containers. It SHALL NOT validate configured values in native documents or AMS orchestration, including host ports, DATA_DIR, provider names, native connection fields or models. Structural or provenance failures SHALL leave the active generation unchanged and preserve desired edits. Semantic service acceptance SHALL belong to actual native loading and runtime execution; startup failures SHALL retain coherent recovery information rather than promising that activation never occurred. AMS SHALL check fingerprints of defaults, overrides, deletion metadata, and relevant orchestration inputs before activation; edits after candidate validation SHALL require preparing and validating a fresh candidate. Activation and snapshots SHALL keep both visible sets, deletion metadata, provenance manifest, non-secret initial-origin state, root association, selected source/images, and persistent secrets as one recoverable configuration version. Recovery SHALL NOT claim application database rollback. Retry SHALL reuse existing secrets without reseeding or rotating credentials.

#### Scenario: Fail candidate validation
- **WHEN** a document has invalid syntax, an invalid deletion instruction or inconsistent provenance
- **THEN** the error identifies its file and setting without disclosing secrets
- **AND** the running installation and active configuration remain unchanged

#### Scenario: Edit an input during preparation
- **WHEN** an operator changes overrides after a candidate was validated
- **THEN** activation detects the changed fingerprint and requires a fresh candidate using the current input
- **AND** the operator's edit is not replaced by stale prepared state

#### Scenario: Recover after activation failure
- **WHEN** activation fails after a coherent candidate has been prepared
- **THEN** the prior version remains recoverable with its matching defaults, overrides, manifest, source/images, root association, and secrets
- **AND** retry does not create new service credentials or administrator identities

### Requirement: Faithful native container consumption

Containers SHALL consume composed native documents through read-only mounts or faithful runtime copies using each service's native configuration interface. Knowledge and Panel SHALL receive composed native environment settings; Panel SHALL also receive its composed instance-registry JSON. Minimal container path, listener, and service-address adaptations SHALL be visible overrides. Any generated environment transport SHALL be derived only from the effective native documents and SHALL NOT form an independent third configuration layer. Native expansion and precedence semantics SHALL be preserved per service; AMS SHALL NOT assume that all YAML files interpolate environment placeholders or introduce shell evaluation of values. Supported literal provider credentials SHALL reach services unchanged. Generated effective documents SHALL be runtime artifacts, not another operator-maintained configuration set.

#### Scenario: Consume native env and YAML together
- **WHEN** a deployment includes Core, MemoryProxy, Knowledge, and Panel
- **THEN** each service receives defaults composed with its overrides in the supported native format
- **AND** generated environment transport supplies no competing native values

#### Scenario: Preserve a literal provider credential
- **WHEN** a supported credential contains dollar signs, quotes, or backslashes
- **THEN** the consuming service receives the intended exact credential without shell execution or unintended recursive interpolation

### Requirement: Persistent native MemoryProxy administrative authentication

Initial setup SHALL generate a native MemoryProxy admin.apiKey with 32 independently generated random bytes when the operator has not supplied one, storing it in overrides. Generated keys SHALL be independent from Core service, model service and Panel/Core administrator credentials. Supplied values SHALL remain unchanged. After setup, AMS SHALL pass operator-edited credentials through without enforcing nonempty values or distinctness, and SHALL NOT regenerate an emptied, removed or deleted override. Ordinary inheritance and explicit deletion semantics SHALL apply. The outer AMS request guard SHALL recognize the configured effective native administrative credential so native MemoryProxy administrative authentication remains reachable, without an AMS method/path/query allowlist or custom role replacement. Routes that use native `checkAdminAuth` SHALL perform their own credential check; keys not matching the configured native administrative credential SHALL not pass it. This contract SHALL NOT extend administrative authentication to upstream routes that do not use it or claim to fix session ownership authorization.

#### Scenario: Configure native administrative access
- **WHEN** initial setup creates a local MemoryProxy configuration without an administrative credential
- **THEN** it saves an independent nonempty administrative override under service-secret permission and redaction rules
- **AND** apply and TDAI updates reuse the same secret

#### Scenario: Reach native instance administration
- **WHEN** a request supplies the effective native administrative credential to a route using native administrative authentication
- **THEN** the outer guard permits native processing and the route's own key comparison succeeds
- **AND** with the independently generated administrative key, an ordinary user credential is rejected by that native administrative check

#### Scenario: Reject a wrong native administrative credential
- **WHEN** a caller supplies an incorrect administrative key
- **THEN** the request receives an authentication failure and the native administrative operation is not executed

#### Scenario: Preserve ordinary user authentication
- **WHEN** an ordinary client calls a supported native user route
- **THEN** existing user authentication and route behavior remain in force without an AMS route allowlist
- **AND** unrelated session authorization remains outside this configuration change

#### Scenario: Administrative override disappears after provisioning
- **WHEN** an initialized installation has a missing, deleted, or empty administrative override
- **THEN** AMS composes the operator-owned value, normal default inheritance or explicit deletion without a credential-policy error
- **AND** no administrative override is regenerated; native TDAI determines the authentication behavior

### Requirement: Configuration check verifies composition integrity

Standalone configuration check SHALL load saved orchestration and the composed native configuration. It SHALL check syntax, overlay/deletion rules, template provenance, root association and other structural integrity needed to read those files. It SHALL NOT validate configured value policies, probe providers, discover models, generate values or claim runtime readiness.

#### Scenario: Check edited configuration without value enforcement
- **WHEN** parseable configuration contains custom ports, paths, URLs, prefixes, models, credentials or provider values
- **THEN** check composes it without enforcing AMS or TDAI semantic constraints
- **AND** syntax, deletion or provenance failures still produce actionable structural errors
