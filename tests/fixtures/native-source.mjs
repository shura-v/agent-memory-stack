import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeTemplateDefinitions } from '../../dist/config/native-templates.js';

// Deliberately small synthetic documents, not vendored upstream templates.
export const nativeSourceFiles = {
  'core.yaml': '# synthetic Core defaults\nllm:\n  maxTokens: 32000\n  timeoutMs: 300000\nmemory:\n  promptMode: code\nskill:\n  extraction:\n    queue:\n      maxRetries: 2\n',
  'proxy.yaml': '# synthetic Proxy defaults\nadmin:\n  apiKey: ""\nsessionInit:\n  maxRetries: 3\n',
  'knowledge.env': '# synthetic Knowledge defaults\nLLM_MAX_TOKENS=32768\nLLM_TIMEOUT_MS=1200000\n',
  'panel.env': '# synthetic Panel defaults\nMETADATA_REMOTE_TIMEOUT_MS=15000\n',
  'panel-instances.json': '{"instances":[]}\n',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function tarFile(prefix, name, text) {
  const content = Buffer.from(text);
  const header = Buffer.alloc(512);
  const write = (value, offset, length) => header.write(value, offset, length, 'ascii');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  write(name, 0, 100); write(octal(0o644, 8), 100, 8);
  write(octal(0, 8), 108, 8); write(octal(0, 8), 116, 8);
  write(octal(content.length, 12), 124, 12); write(octal(0, 12), 136, 12);
  write('        ', 148, 8); write('0', 156, 1);
  write('ustar\0', 257, 6); write('00', 263, 2); write(prefix, 345, 155);
  write([...header].reduce((total, byte) => total + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512)]);
}
export function createNativeSourceFixture({ revision = 'a'.repeat(40), files = {} } = {}) {
  const documents = { ...nativeSourceFiles, ...files };
  const prefix = `TencentDB-Agent-Memory-${revision}`;
  const records = Object.entries(documents).filter(([, value]) => value !== undefined)
    .map(([name, text]) => tarFile(prefix, nativeTemplateDefinitions[name].sourcePath, text));
  const bytes = gzipSync(Buffer.concat([...records, Buffer.alloc(1024)]));
  const source = { revision, url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${revision}`, sha256: hash(bytes) };
  return { source, files: documents, bytes };
}
export async function installNativeSourceFixture(projectDir, fixture = createNativeSourceFixture(), { select = true } = {}) {
  const cache = join(projectDir, '.ams-build/.cache/upstream');
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, `tencent-${fixture.source.revision}.tar.gz`), fixture.bytes);
  if (select) {
    await mkdir(join(projectDir, '.ams'), { recursive: true });
    await writeFile(join(projectDir, '.ams/tdai-source.json'), JSON.stringify(fixture.source) + '\n');
  }
  return fixture;
}
