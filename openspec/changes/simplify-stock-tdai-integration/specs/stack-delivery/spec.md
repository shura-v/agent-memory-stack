## MODIFIED Requirements

### Requirement: Installable npm package with stack configuration

The delivery SHALL be an npm package named `agent-memory-stack` exposing `ams`. Configure stack and Apply configuration SHALL remain explicitly selected actions, with Configure initially selected. Menu Apply, standalone `ams apply` and immediate application SHALL use one saved-target workflow without configuration questions. The package SHALL include AMS-owned compiled code, build recipes and source metadata, and SHALL exclude TDAI template copies, source patches, installation credentials and runtime data. Native templates SHALL be acquired from the selected source independently of the caller's checkout.

#### Scenario: Install the packed package
- **WHEN** the operator configures an isolated installation from the installed npm archive
- **THEN** AMS obtains selected-source templates into flat defaults and saves operator overrides
- **AND** no developer checkout, packaged native template tree, running engine or image build is required to save configuration

#### Scenario: Apply saved configuration from the menu or command
- **WHEN** the operator selects Apply configuration or runs `ams apply`
- **THEN** both apply the saved files without invoking Configure or requesting model choices

### Requirement: One editable server environment file

AMS orchestration settings SHALL reside in the runtime `.env`; native TDAI configuration SHALL reside in the recorded flat defaults/overrides sets. Composed container inputs SHALL be derived artifacts, not another editable source. Apply SHALL read both sets and recreate containers as needed. The initial Core administrator user key SHALL not be persisted as a separate configuration copy. MemoryProxy's independent administrative credential SHALL be initialized in `overrides/proxy.yaml` at `admin.apiKey`; subsequent operator changes SHALL remain unvalidated and SHALL not be automatically restored. No custom dotenv encoding or injected parser SHALL replace native service semantics.

#### Scenario: Apply a new model or endpoint
- **WHEN** the user changes the model in its native override and runs Apply
- **THEN** the consuming service receives the composed native document without requiring a duplicate model in runtime `.env`
- **AND** Apply does not rotate credentials or repopulate intentionally removed values

#### Scenario: Check configuration without execution
- **WHEN** standalone configuration check reads an installation
- **THEN** it checks parsing, composition and provenance without writes or configured-value policy
- **AND** its success does not claim that upstream accepts the values or that services are operational

#### Scenario: Preserve literal provider keys
- **WHEN** a saved provider key contains characters interpreted by the native service parser
- **THEN** AMS preserves the operator's file value and delivers it without shell evaluation
- **AND** runtime expansion and quoting follow the stock parser rather than an AMS corrective codec

### Requirement: Pinned images and separate build lifecycle

Build definitions SHALL record immutable source revisions, supported base-image identities and output image/platform identities. TDAI dependencies SHALL come from the selected upstream manifests and locks where supplied; AMS SHALL NOT substitute its own TDAI manifests or locks. Missing upstream locks SHALL be reported as a reproducibility limitation. AMS-owned dependencies SHALL retain their own locks. Apply SHALL reuse verified images and build missing images before starting services. Offline delivery SHALL include compatible images, source provenance and the verified source archive needed to extract native defaults, without secrets or operator overrides. Licenses SHALL remain included.

#### Scenario: Build and deliver images
- **WHEN** images are built from the selected source
- **THEN** AMS verifies the archive, uses upstream dependency inputs and records output content/platform identities
- **AND** the installed package can reuse those images without a developer checkout

#### Scenario: Upstream changes a dependency
- **WHEN** a selected TDAI revision changes its package manifest or supplied lock
- **THEN** the build consumes that revision's files without overlaying previous AMS copies

#### Scenario: Offline installation
- **WHEN** an installation imports a complete compatible image/source bundle without network access
- **THEN** it can extract native defaults and use the verified images without downloading or compiling sources on that host
- **AND** native files retain the same flat defaults/overrides layout

#### Scenario: Source or platform mismatch
- **WHEN** archive integrity or image platform verification fails
- **THEN** delivery stops before service initialization and preserves the previous configuration
