import { readFile, writeFile } from 'node:fs/promises';

// Supergateway 3.4.3 has no listen-host option for stateful Streamable HTTP.
// Only the authenticated AMS boundary may be reachable on the container network.
const path = 'node_modules/supergateway/dist/gateways/stdioToStatefulStreamableHttp.js';
let source = await readFile(path, 'utf8');
for (const [before, after] of [
  ['app.listen(port, () => {', "app.listen(port, '127.0.0.1', () => {"],
  // Kill the adapter itself when a session expires; a shell can leave it orphaned.
  ['const child = spawn(stdioCmd, { shell: true });', "const child = spawn(process.execPath, ['/app/runtime/mcp-adapter.js'], { shell: false });"],
]) {
  if (source.split(before).length !== 2) throw new Error('Review Supergateway isolation patch for this version');
  source = source.replace(before, after);
}
await writeFile(path, source);
