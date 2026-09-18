# Development

Use **Node.js 24 or newer** and npm. For installing and operating a stack, see
[Operations](operations.md). For code structure and runtime boundaries, see the
[architecture guide](architecture/README.md).

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
