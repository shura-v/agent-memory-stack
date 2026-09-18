# Updating TDAI on the server

```sh
ams update tdai
```

Run this on the machine hosting the stack. AMS uses the last saved installation, just like `ams apply`.

The command downloads the latest TDAI revision from `feat/server_team`, records its commit and archive checksum in the installation's `.ams/tdai-source.json`, then builds and applies the update. It works with the installed npm package; no Git checkout or submodule is required. Package files and the packaged CLIProxyAPI version stay unchanged.

Later `ams apply` runs keep the selected TDAI revision. Run `ams update tdai` again to select a newer revision. The ordinary configuration snapshot includes this source selection.

Image bundles include the selected TDAI revision and archive checksum. Export from a configured installation includes only the images required by its saved `.env`; retained images for disabled services are excluded. Importing a bundle restores the source selection, so applying it reuses matching imported images without downloading TDAI again.

Build failures leave running services unchanged. Upstream changes can require newer AMS patches or dependency locks; compatibility fixes may require a newer AMS package. After the source selection is saved, a failed apply retains it for retry with `ams apply`.

From the AMS development checkout, the equivalent command is `npm run dev -- update tdai`.
