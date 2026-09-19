import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { acquireSourceArchive, loadSourceLock, validateTdaiSource, verifyArchive } from '../build/sources.js';
import type { SourceLock } from '../build/sources.js';
import type { NativeFormat } from './native-documents.js';
import { parseNativeDocument } from './native-documents.js';

export const nativeTemplateDefinitions = {
  'core.yaml': { sourcePath: 'MemoryCore/tdai-gateway.yaml', format: 'yaml' },
  'proxy.yaml': { sourcePath: 'MemoryProxy/config.example.yaml', format: 'yaml' },
  'knowledge.env': { sourcePath: 'MemoryKnowledge/.env.example', format: 'env' },
  'panel.env': { sourcePath: 'MemoryPanel/.env.example', format: 'env' },
  'panel-instances.json': { sourcePath: 'MemoryPanel/config/metadata-instances.example.json', format: 'json' },
} as const satisfies Record<string, { sourcePath: string; format: NativeFormat }>;
export type NativeFileName = keyof typeof nativeTemplateDefinitions;
export const nativeFileNames = Object.keys(nativeTemplateDefinitions) as NativeFileName[];
export interface NativeTemplateManifest {
  schemaVersion: 1;
  source: SourceLock;
  templates: Record<NativeFileName, { sourcePath: string; sha256: string; format: NativeFormat }>;
}
export interface NativeTemplateSet { manifest: NativeTemplateManifest; files: Record<NativeFileName, string> }
const digest = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex');

function validateManifest(value: unknown, expected?: SourceLock): NativeTemplateManifest {
  const manifest = value as NativeTemplateManifest;
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.templates || typeof manifest.templates !== 'object') throw new Error('Invalid native template manifest');
  const source = validateTdaiSource(manifest.source);
  if (expected && (source.revision !== expected.revision || source.sha256 !== expected.sha256 || source.url !== expected.url)) throw new Error('Native templates do not match the selected TDAI source');
  if (Object.keys(manifest.templates).length !== nativeFileNames.length) throw new Error('Native template manifest has unexpected files');
  for (const name of nativeFileNames) {
    const entry = manifest.templates[name];
    const definition = nativeTemplateDefinitions[name];
    if (!entry || entry.sourcePath !== definition.sourcePath || entry.format !== definition.format || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid native template provenance: ${name}`);
  }
  return { schemaVersion: 1, source, templates: manifest.templates };
}

export function validateNativeTemplates(set: NativeTemplateSet, expected?: SourceLock): NativeTemplateSet {
  const manifest = validateManifest(set.manifest, expected);
  for (const name of nativeFileNames) {
    if (typeof set.files[name] !== 'string' || digest(set.files[name]) !== manifest.templates[name].sha256) throw new Error(`Native template SHA-256 mismatch: ${name}`);
    parseNativeDocument(set.files[name], manifest.templates[name].format);
  }
  return { manifest, files: set.files };
}

/** Extract only named regular files, without trusting or unpacking archive paths. */
export async function extractNativeTemplates(archivePath: string, input: SourceLock): Promise<NativeTemplateSet> {
  const source = validateTdaiSource(input);
  const bytes = await readFile(archivePath);
  verifyArchive(bytes, source.sha256, 'TDAI native templates');
  const prefix = `TencentDB-Agent-Memory-${source.revision}/`;
  const listing = execFileSync('tar', ['-tzf', '-'], { input: bytes, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n');
  const files = {} as Record<NativeFileName, string>;
  const templates = {} as NativeTemplateManifest['templates'];
  for (const name of nativeFileNames) {
    const definition = nativeTemplateDefinitions[name];
    const entry = prefix + definition.sourcePath;
    if (listing.filter(path => path === entry).length !== 1) throw new Error(`Missing or duplicate native template in selected TDAI archive: ${name}`);
    const details = execFileSync('tar', ['-tvzf', '-', entry], { input: bytes, encoding: 'utf8' }).trim();
    if (!details.startsWith('-') || details.includes('\n')) throw new Error(`Native template must be a regular archive file: ${name}`);
    const content = execFileSync('tar', ['-xzOf', '-', entry], { input: bytes, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    files[name] = content;
    templates[name] = { ...definition, sha256: digest(content) };
  }
  return validateNativeTemplates({ manifest: { schemaVersion: 1, source, templates }, files }, source);
}

/** Templates come only from the selected, verified source archive. */
export async function getNativeTemplates(projectDir: string, selected?: SourceLock): Promise<NativeTemplateSet> {
  const source = validateTdaiSource(selected ?? (await loadSourceLock(projectDir)).sources.tencent);
  const archive = await acquireSourceArchive(projectDir, 'tencent', source);
  return extractNativeTemplates(archive, source);
}
