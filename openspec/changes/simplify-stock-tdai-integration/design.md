## Context

See proposal.md for scope. The operator explicitly accepts upstream TDAI bugs, prohibits editing its sources/dependencies, wants flat defaults/overrides outside this repository, and keeps the external AMS MCP endpoint while asking to reuse stock stdio MCP.

Observed before this planning boundary:

| Coupling | Evidence | Intended disposition |
| --- | --- | --- |
| Source patch pipeline | Former `src/patches/apply.ts`: 24 existing TDAI files and 8 added files | Remove, including auth, session/asset guards, Codex instructions, cancellation, telemetry, Node version and UI changes |
| Dependency replacement | `deploy/node.Dockerfile` overlaid five `deploy/locks/*/package*.json` sets | Use selected source manifests and available upstream locks |
| Injected configuration loader | TDAI entrypoints imported AMS environment modules; derived native `*-env.json` files and `# ams:json` codec | Mount native files and preserve native parser behavior |
| Private service protocol | `/ams/identity`, UUID files, callback headers, `knowledge-service` and pairing probes | Direct native connections/callbacks and process health |
| Vendored templates | Repository `native-templates/<revision>` and staged `.ams/native-templates/<revision>` | Acquire from verified source; no revision-named configuration trees |
| Duplicate configuration | Full `serviceConfigs()` alongside native composition | One native composition path; separate small configs only for AMS-owned processes |
| Replacement MCP tools | `mcp-adapter.ts` exposes two generic tools instead of upstream MCP | Execute stock stdio tools behind the retained external boundary |

Some removals already exist in the working tree; the tree is incomplete and is not a tested stock deployment. Build-layer checks passed 35 tests; a stock Core build was stopped during system package installation. Previous 410 host tests and seven container checks cover an earlier, patched implementation. None establishes acceptance of this design. Old compiled modules can remain in `dist` until a clean build.

## Goals / Non-Goals

**Goals:** keep the upstream/application boundary explicit; remove duplicated behavior and configuration sources; preserve the complete local stack, user edits, secret handling, and existing AMS MCP user isolation.

**Non-Goals:** repair TDAI, add a replacement business backend, implement new tool schemas, recreate its authorization inside its processes, preserve obsolete development layouts, migrate databases, support service subsets, or introduce a general integration/plugin framework.

## Decisions

### 1. Unchanged upstream inputs and native startup

Fetch and verify the selected source archive; unpack it without changing application files, manifests or locks. Compile with upstream build commands and dependencies. Use a supported Node major (the inspected Proxy requires Node 22). Ordinary compiler/install outputs are build artifacts, not permission to rewrite inputs. If an upstream build recipe itself edits a manifest, do not reproduce that mutation: report the incompatibility. Core/Knowledge currently lack npm locks; do not invent AMS-owned substitutes or claim fully locked dependencies.

Remove patch assets, patch fingerprint inputs, corrective build scripts and TDAI preload injection. Keep image/source digests and licenses. AMS-owned dependencies, including its transport dependencies, retain their own locks. Copying source/package files into a build context is permitted; modifying their contents is not.

Mount Core YAML at its configured native path; Proxy receives YAML through `--config`. Mount Knowledge and Panel env files as `/app/.env`, with the stock application working directory. Mount Panel's native registry JSON at the path selected in its env. Native env/YAML expansion, precedence, quoting and bugs remain upstream behavior; no custom codec or runtime monkey patch restores different semantics. Native config/env delivery replaces program injection.

### 2. One flat defaults directory and one overrides directory

```text
~/.config/agent-memory-stack/
  defaults/
    core.yaml
    proxy.yaml
    knowledge.env
    panel.env
    panel-instances.json
  overrides/
    core.yaml
    proxy.yaml
    knowledge.env
    panel.env
    panel-instances.json
    deletions.json       # only when explicit native-field deletion is used
```

The existing absolute XDG root override and recorded root association remain. Source revision and checksums belong to metadata outside these sets; filenames and directory layout do not change with revisions. No `defaults/<revision>`, packaged template fallback, hidden populated seed, or third editable settings set.

Initial Configure acquires the verified source when no usable local archive exists. It extracts exactly the five known native templates into defaults and seeds only known installation overrides. Initial save can require a source download, but not an engine, image build or provider login. Offline operation uses an already verified archive or an imported bundle. Existing Apply reads the current sets without fetching templates again; an explicit TDAI update obtains new defaults, preserves override bytes and activates a coherent generation.

Cache source archives as ordinary build/download artifacts; revision identifiers may occur in archive filenames and metadata, not configuration subdirectories. Offline bundles carry a verified source archive with images/provenance, allowing extraction into the same flat defaults layout. Remove the intermediate revision-indexed template store. A bundle is a distribution artifact, not another editable configuration source.

Retain the established small composition contract: mapping merge, array/scalar replacement and explicit deletion metadata. Keep syntax, provenance, association, concurrent-edit protection and one previous coherent snapshot. Remove semantic policy checks, ownership inference, migration branches and duplicate generation. Configure owns model questions; Apply never discovers, requires, fills or rewrites model choices. Initial credential generation remains separate from subsequent operator edits.

### 3. Native service links and observable failures

Keep six applications and three helpers: `config`, `bootstrap`, `access`. Panel uses `http://knowledge:8421`; Knowledge uses its configured stock Panel callback. Remove the `knowledge-service` proxy, injected identity files/endpoints and authenticated-pairing protocol. Bootstrap uses stock Core APIs. Readiness checks container health/completion and reports provider authorization and functional checks separately.

Known stock limitation: Proxy's native auth request omits the service Bearer required by Core when `server.apiKey` is nonempty. Do not patch Proxy, add a transparent auth-repair proxy, or clear the configured Core key to bypass it. Likewise retain upstream callback authentication, session checks, prompt injection and cancellation behavior. A failing native operation is an upstream result, not permission to add another workaround.

### 4. Stock stdio MCP behind the AMS boundary

Use the stock Knowledge MCP build artifact directly (the inspected build produces `dist/mcp/server.mjs`), with native `KNOWLEDGE_API_URL`, `KNOWLEDGE_API_TOKEN` and `LOG_LEVEL=error`. Direct entry selection and native log configuration avoid the inspected wrapper/stdio issues without changing files. Package the unchanged stock artifact/dependencies produced by the selected revision. Remove the AMS implementation of two generic tool schemas and invocation semantics.

```text
agent → AMS authenticated HTTP /mcp → HTTP/stdio transport → stock TDAI MCP
      → internal AMS access bridge → stock Knowledge HTTP API
```

Reuse the existing worker/session lifecycle and user-key isolation. The internal bridge is the existing `access` responsibility, not an additional public service or generic proxy framework. It supplies `x-tdai-service-id`, which the stock client omits. It forwards native bodies/results and retains resource authorization on the AMS-owned entry point using stock Core APIs. Existing consumers do not grant permission to weaken this boundary merely by replacing the tool implementation.

The inspected stock server has 12 query tools: eight CodeGraph tools (`code_search`, `code_explore`, `code_callers`, `code_callees`, `code_impact`, `code_node`, `code_status`, `code_files`) and four Wiki tools (`wiki_search`, `wiki_read`, `wiki_list`, `wiki_graph`). Resource IDs arrive as `code_graph_id` or `wiki_id`, rather than the old generic `knowledge_id`. Extend the existing access routing table only for these actual stock endpoints and map them to existing resource/type/team/ACL checks. Do not copy schemas, implement tools, synthesize privileged identities or expose create/delete/admin endpoints. New upstream tool routes require an explicit bridge compatibility review; never silently elevate or broadly forward unknown paths.

This external adaptation is specifically requested for MCP and does not authorize fixes elsewhere in TDAI. Supergateway and any remaining AMS transport customization must be reviewed for actual necessity; no TDAI patch may be moved into a preload, startup wrapper or HTTP response rewriter.

A temporary prototype compiled unchanged stock MCP sources with an existing compiler, initialized the server, listed 12 tools, and called `wiki_search` against a synthetic HTTP server. Direct forwarding lacked the service header; an external bridge adding it succeeded. Evidence: `/var/folders/0q/p8kvqpfs3hzd_vd6p_2694n40000gn/T/ams-stock-mcp-probe-Q4KZXs/evidence.json`. This proves transport feasibility only: production stock compilation, Supergateway/container integration and real resource authorization are still acceptance tasks.

### 5. Reconcile promises and remove dead machinery

Update docs and delta requirements to distinguish stock behavior from AMS-owned behavior. Remove assertions that AMS repairs Proxy authorization, session ownership, final prompt contents, callbacks or cancellation. Retain tests of acquisition byte integrity, native file delivery, operator preservation and the external MCP boundary. Replace patched-model smoke expectations with stock diagnostics and explicit evidence limits; never change upstream code merely to make acceptance green.

Earlier active changes remain historical planning inputs. At an explicitly requested future sync, apply prerequisite deltas before this final contract and reconcile overlapping requirements (notably native-template packaging, callback pairing and the old generic MCP tool contract). This planning operation edits neither main specs nor sibling changes. The implementation checklist starts with review of partial edits and ends with fresh evidence; no previous completion boxes carry over.

## Risks / Trade-offs

- Stock bugs can make an otherwise healthy stack unusable for an operation → report the exact failing stage/revision and preserve the invariant; do not claim functional acceptance from container health.
- Stock dependencies without upstream locks can change on reinstall → record source/base/image identities and this reproducibility limit; deliver built images for offline reuse.
- Native parsers can transform unusual values → test actual native behavior and document it, without a second parsing language or corrective injection.
- Stock MCP tool paths can evolve → test schemas against the executed stock server and maintain only the small access boundary needed for those routes.
- Initial setup now needs templates from source → test download failure, verified cache reuse and offline bundle installation before saving/activation.

## Implementation and recovery

Review and finish the partial removals, then integrate stock transport/template acquisition/MCP before running a clean build. Use isolated synthetic installations for acceptance. Keep existing coherent configuration/source/image snapshots for recovery; do not migrate development formats or touch the user's active deployment. If stock build/start fails, record it as incomplete acceptance rather than applying a local upstream fix.
