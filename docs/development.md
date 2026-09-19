# Development

Use **Node.js 24 or newer** and npm. For installing and operating a stack, see
[Operations](operations.md). For code structure and runtime boundaries, see the
[architecture guide](architecture/README.md).

## Integration boundaries

AMS always deploys Core, Knowledge, Panel, MemoryProxy, CLIProxyAPI and MCP,
plus its configuration, bootstrap and access helpers. Service subsets and remote
Core/Knowledge placement are not configuration modes.

| Owner | Files and responsibility |
| --- | --- |
| Upstream sources | `vendor/upstream.lock.json` pins verified archives; source caches are build inputs |
| TDAI | Its source, manifests, dependency locks and built stdio MCP stay unchanged |
| AMS delivery | `deploy/` contains Dockerfiles; root `package.json` and `package-lock.json` supply AMS and MCP gateway dependencies |
| Operator configuration | Flat `defaults/` and `overrides/` in the native configuration directory compose service documents; runtime `.env` holds AMS settings |
| AMS transport | Official SDK stateless HTTP and stdio transports connect each authenticated MCP POST to its own stock child process; the access helper checks Knowledge resource permissions |

Configure acquires the selected upstream templates and fills known override
fields, including model choices. Apply composes saved files without asking for
models or semantically validating operator values. Parsing, source integrity,
ownership and runtime prerequisite checks still apply. See
[native configuration](native-configs.md) for merge and update rules.

Changes to upstream behavior belong upstream. Keep fixes to TDAI source,
dependency replacements, preload repairs and replacement tool schemas out of
AMS. A failing native behavior is a diagnostic result, not permission to repair
it in the image. Each authenticated MCP POST uses the SDK stateless transport and an isolated
stock stdio child. Response completion, disconnect or failure closes the child.
The gateway keeps at most 64 children active globally. A new authenticated
request at capacity replaces the oldest active request after its child exits.
The endpoint returns JSON, issues no MCP session ID and rejects GET/DELETE with
405. No credential pools, session maps, leases, idle expiry or waiting queue
remain. The inspected stock server advertises only tools, with no reverse
requests or notifications; stateful capabilities are not emulated.

## Run from a checkout

```sh
git clone https://github.com/shura-v/agent-memory-stack.git
cd agent-memory-stack
npm ci
npm run dev
```

`npm run dev` builds the TypeScript sources and opens the CLI. To apply saved
stack settings directly:

```sh
npm run dev -- apply
```

Apply performs deployment work against the configured stack. Check the selected
configuration and container engine before running it; see
[Operations](operations.md) for the stack workflow.

`npm ci` reads the root `package-lock.json`, shared with the MCP image. Build
copies that lock to `dist/build/package-lock.json` as a generated package resource
for container builds from an installed AMS package. The image build places the
copy at its context root for `npm ci`. npm installation of the published CLI has
no shrinkwrap. TDAI uses its own supplied dependency metadata;
do not add service dependency overlays under `deploy/` or `vendor/`.

## Check changes

```sh
npm run typecheck
npm test
```

`typecheck` checks TypeScript without emitting files. `npm test` builds the project
and runs the standard test suite. Image-dependent and container smoke tests are
opt-in and require their own setup; ordinary test success does not establish live
stack, provider, agent, or Wiki behavior.

See [Delivery validation](../VALIDATION.md) for the opt-in commands, prerequisites,
recorded evidence, and remaining live acceptance checks. Run heavy integration
suites serially and use their isolated test projects.

`npm run check:env` reads the `server` installation's composed configuration;
for another runtime directory, use `node dist/runtime/config.js check /path/to/runtime`.
This checks that saved files can be read and composed. It does not enforce a
value policy for ports, paths, model names, credentials or upstream options.

## Build and install a local package

```sh
npm pack
```

The `prepack` script builds the project, then npm writes a local tarball without
publishing it. Install the filename printed by `npm pack`; for version `0.1.0`:

```sh
npm install --global ./agent-memory-stack-0.1.0.tgz
ams
```

This makes the packaged CLI available as `ams`. Continue with
[Operations](operations.md) to configure or apply a stack.

## Publish documentation

The [documentation site](https://shura-v.github.io/agent-memory-stack/) is a static
GitHub Pages site. Edit `docs/index.html` for the landing page; the diagrams live
in `docs/architecture/`, with their editable specifications and validation receipts.
The overview image lives in `docs/images/`.

Edit `docs/architecture/stack.json` and `mcp.json`, then validate and deliver each
HTML with Archify. Refresh the adjacent delivery, source and visual-review
receipts and the overview screenshot from the delivered stack map. The
[architecture guide](architecture/README.md) links these artifacts. Keep factual
labels tied to source paths; successful diagram validation establishes layout,
not service or provider functionality.

The `Publish documentation` workflow deploys the landing page, two diagram HTML
files, and overview image when those files change on `main`. It can also be run
manually from `main` in GitHub Actions. Setup and development guide links open the
Markdown files on GitHub. Diagram source specifications and review artifacts stay
in the repository.

For the first release, make the repository public, then enable Pages in
**Settings → Pages → Build and deployment → Source → GitHub Actions**. See
[GitHub's Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
for the publishing settings. After enabling Pages, merge these files into `main`
or run `Publish documentation` manually from `main` if they have already merged.

Pages uses **GitHub Actions** as its publishing source. Release-branch pushes do
not deploy; merge the documentation into `main` to publish it. The workflow does
not build or publish the npm package or container images.
