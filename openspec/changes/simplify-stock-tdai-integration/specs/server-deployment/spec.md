> Synchronized with the current main specification on 2026-09-19. Overlapping requirements reflect the final stock-TDAI contract; prior design narratives remain historical. Archive this already-synchronized change without applying its deltas again.

## ADDED Requirements

### Requirement: Native APIs and separate AMS access boundary

MemoryProxy, Core, Knowledge and Panel SHALL use their selected upstream authentication behavior and native configuration. AMS SHALL not patch their user/session/asset checks or add a TDAI route allowlist. The separate AMS MCP/access endpoint SHALL retain its own caller and resource authorization. Native administrative protection SHALL use configured `admin.apiKey`; AMS SHALL not substitute a Panel user key. Host listeners SHALL default to loopback, and external proxy/firewall configuration SHALL remain operator-owned. Documentation SHALL distinguish native behavior from the AMS boundary's guarantees.

#### Scenario: Native agent request
- **WHEN** an agent contacts a native MemoryProxy route
- **THEN** its original path, query, method and body reach the stock handler
- **AND** the handler's stock authentication result is preserved, including upstream defects

#### Scenario: Unauthorized AMS tool request
- **WHEN** a caller uses the external AMS MCP/access endpoint without valid user/resource authorization
- **THEN** the AMS boundary denies forwarding without modifying TDAI

### Requirement: Observable stock streaming and readiness

AMS SHALL report process readiness separately from account authorization, external proxy availability and functional memory/model checks. Streaming, cancellation and retry behavior inside TDAI SHALL remain upstream-owned. AMS SHALL NOT patch handlers to enforce a different result or present old patched-stream tests as current acceptance.

#### Scenario: Observe a stock stream
- **WHEN** a stock TDAI streaming request is exercised and cancelled
- **THEN** validation records the observed behavior for that revision
- **AND** a cancellation or replay defect is reported without a local application correction

### Requirement: Native conversation and asset behavior

AMS client guidance SHALL pass the selected user, team, agent and conversation identifiers through native interfaces. Native TDAI SHALL determine session ownership, optional task handling and conversation persistence. AMS SHALL not alter native session stores, asset listings or ownership decisions; resource authorization at the separate AMS MCP/access boundary SHALL remain enforced.

#### Scenario: Native conversation request
- **WHEN** an agent submits or resumes a conversation using the documented native identifiers
- **THEN** AMS preserves those inputs and reports the actual upstream result without injecting an ownership or persistence fix

### Requirement: Native tool instructions and AMS secret handling

Native prompt construction, tool URLs, credential inclusion and injection behavior SHALL remain owned by TDAI. AMS SHALL supply supported native configuration and SHALL NOT rewrite generated instructions or patch Codex input handling. AMS-owned output, configuration review and MCP transport SHALL retain credential redaction and user isolation. Documentation SHALL not promise that stock model-visible instructions implement prior AMS patches.

#### Scenario: Native Codex instructions
- **WHEN** a client supplies a Responses instructions string
- **THEN** the stock Proxy determines how memory/tool content is included
- **AND** AMS does not modify the handler or rewrite its outgoing model request

### Requirement: Native standalone forwarding configuration

AMS SHALL express initial standalone preferences, including pricing, credit-reporting and rate-limit settings, using native configuration only. The selected TDAI revision SHALL determine the effect of those settings. AMS SHALL NOT alter forwarding or reporting code when a native setting is ignored or behaves unexpectedly.

#### Scenario: Native forwarding configuration
- **WHEN** the configured upstream receives a model request with standalone native options
- **THEN** its observed result is reported without an AMS code patch or fabricated guarantee that sample reporting is disabled

## REMOVED Requirements

### Requirement: Authenticated APIs and operator-controlled exposure

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Native APIs and separate AMS access boundary". No development-format migration is provided; native behavior and the external AMS boundary are described separately.

### Requirement: Streaming and readiness remain observable

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Observable stock streaming and readiness". No development-format migration is provided; native behavior and the external AMS boundary are described separately.

### Requirement: Preserve conversation and asset identity

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Native conversation and asset behavior". No development-format migration is provided; native behavior and the external AMS boundary are described separately.

### Requirement: Authenticated tool instructions without embedded secrets

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Native tool instructions and AMS secret handling". No development-format migration is provided; native behavior and the external AMS boundary are described separately.

### Requirement: Standalone forwarding defaults

**Reason**: The operator explicitly requires unmodified TDAI and removes the prior patched or split-deployment contract.

**Migration**: Use the replacement requirement "Native standalone forwarding configuration". No development-format migration is provided; native behavior and the external AMS boundary are described separately.
