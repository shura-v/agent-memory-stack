# Updating TDAI on the server

```sh
ams update tdai
```

Run this on the machine hosting the stack. AMS uses `~/.agent-memory-stack`, just like `ams apply`, regardless of the working directory.

The command downloads the latest TDAI revision from `feat/server_team` and prepares its verified native templates and images. Desired source selection stays pending until document checks and image preparation succeed; activation records its commit and archive checksum in the installation's `.ams/tdai-source.json`. It works with the installed npm package; no Git checkout or submodule is required. Package files and the packaged CLIProxyAPI version stay unchanged.

Later `ams apply` runs keep the selected TDAI revision. Run `ams update tdai` again to select a newer revision. The configuration snapshot includes this source selection, both visible native sets, deletion declarations and the runtime native-root reference.

| Input | Location | Update behavior |
| --- | --- | --- |
| Selected upstream source | Runtime `.ams/tdai-source.json` | Records the activated revision and verified archive |
| Original native templates | Native root `defaults/` | Replaced with all five originals from that revision |
| Operator service settings | Native root `overrides/` | Preserved, with priority over the new defaults |
| AMS orchestration settings | Runtime `.env` | Reused; host ports may be reallocated if occupied |
| TDAI application and MCP artifacts | Prepared container images | Rebuilt from stock source with matching revision records |

The native root normally is `~/.config/agent-memory-stack`; its exact saved location is in runtime `.ams/native-config.json`. Files sit directly in `defaults/` and `overrides/`, with no revision subdirectories. Inspect defaults to discover newly available settings, then put your changes in overrides before the next Apply.

Each update stages all five new original templates in `defaults/` and combines them with byte-preserved `overrides/`. Fields without overrides adopt new defaults; explicit overrides retain priority. AMS checks the source archive, syntax, overlay/deletion rules and input freshness. Native and AMS orchestration values remain operator-owned; service loaders or runtime readiness can fail after activation, requiring an edit and retry. AMS does not reject custom ports, DATA_DIR, engine/provider choices, paths, URLs, prefixes, models or keys in advance. See [native configuration and override rules](native-configs.md).

Image bundles include the selected TDAI revision, archive checksum and the verified source archive used to extract the five original templates. They contain no operator overrides, secrets or populated runtime files. A missing or corrupt source archive blocks import before activation. Every image bundle contains the complete seven-image set: six application images and the shared runtime image. Importing a bundle restores the source selection, so applying it reuses matching imported images without downloading TDAI again.

Build failures leave running services unchanged. TDAI sources, manifests and supplied locks are used unchanged. Upstream build/start defects are reported without local repairs. Core and Knowledge currently supply no npm lock, so their dependency ranges are not fully reproducible; distribute built images when exact reuse is needed. A failed preflight retains the desired revision as pending for retry with `ams apply`, while active source/template/image records remain paired with the previous generation. Startup failure retains the prior configuration snapshot for recovery; restoring it does not roll back application database migrations.

From the AMS development checkout, the equivalent command is `npm run dev -- update tdai`.
