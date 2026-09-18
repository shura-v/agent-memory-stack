import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { imageServices, validateDeploymentImages, validateImageManifest, writeImageManifest } from './images.js';
import type { ContainerRuntime, ImageManifest, ImagePlatform } from './images.js';
import { loadSourceLock, validateTdaiSource } from './sources.js';
import type { SourceLock } from './sources.js';
import { atomicWrite, readEnv } from '../config/files.js';
import { resolveDeployment } from '../deployment/model.js';
import { preserveInputs } from '../setup/server-settings.js';

interface BundleMetadata { schemaVersion: 1; archiveSha256: string; manifestSha256: string; tdaiSourceSha256?: string }
export interface ExportOptions { projectDir: string; outputDir: string; runtime: ContainerRuntime }
export interface LoadOptions { bundleDir: string; projectDir: string; runtime: ContainerRuntime; platform?: ImagePlatform }

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function run(runtime: ContainerRuntime, args: string[]): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn(runtime, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${runtime} ${args[0]} failed (${code})`)));
  });
}

export function runtimePlatform(runtime: ContainerRuntime): ImagePlatform {
  if (!['docker', 'podman'].includes(runtime)) throw new Error('Container runtime must be docker or podman');
  const args = runtime === 'podman' ? ['info', '--format', 'json'] : ['info', '--format', '{{json .}}'];
  const info = JSON.parse(execFileSync(runtime, args, { encoding: 'utf8' }));
  const arch = runtime === 'podman' ? info.host?.arch : info.Architecture;
  const os = runtime === 'podman' ? info.host?.os : info.OSType;
  const platform = `${os}/${({ x86_64: 'amd64', aarch64: 'arm64' } as Record<string, string>)[arch] ?? arch}`;
  if (platform !== 'linux/amd64' && platform !== 'linux/arm64') throw new Error(`Unsupported container runtime platform: ${platform}`);
  return platform;
}

const tdaiServices = ['core', 'knowledge', 'panel', 'memory-proxy'];
const includesTdai = (manifest: ImageManifest) => tdaiServices.some(service => service in manifest.images);
function verifySourceRevision(service: string, labels: Record<string, string> | undefined, source?: SourceLock): void {
  if (source && tdaiServices.includes(service) && labels?.['org.opencontainers.image.revision'] !== source.revision) {
    throw new Error(`TDAI source selection does not match bundled image: ${service}. Rebuild or restore the matching source selection before exporting.`);
  }
}

function verifyLocalImages(runtime: ContainerRuntime, manifest: ImageManifest, source?: SourceLock): void {
  for (const service of imageServices.filter(service => manifest.images[service])) {
    const image = manifest.images[service]!;
    const [inspection] = JSON.parse(execFileSync(runtime, ['image', 'inspect', image.id], { encoding: 'utf8' }));
    const id = inspection.Id.startsWith('sha256:') ? inspection.Id : `sha256:${inspection.Id}`;
    if (id !== image.id || `${inspection.Os}/${inspection.Architecture}` !== image.platform) throw new Error(`Local image does not match manifest: ${service}`);
    verifySourceRevision(service, inspection.Config?.Labels, source);
  }
}

function verifyArchiveImages(archive: string, manifest: ImageManifest, source?: SourceLock): void {
  const entries = JSON.parse(execFileSync('tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })) as Array<{ Config: string }>;
  const configs = new Map<string, { config?: { Labels?: Record<string, string> } }>(entries.map(entry => {
    if (typeof entry.Config !== 'string' || entry.Config.startsWith('-')) throw new Error('Invalid archive configuration entry');
    const config = execFileSync('tar', ['-xOf', archive, entry.Config], { maxBuffer: 4 * 1024 * 1024 });
    return [`sha256:${createHash('sha256').update(config).digest('hex')}`, JSON.parse(config.toString('utf8'))] as const;
  }));
  for (const service of imageServices.filter(service => manifest.images[service])) {
    const config = configs.get(manifest.images[service]!.id);
    if (!config) throw new Error(`Archive is missing the configured image: ${service}`);
    verifySourceRevision(service, config.config?.Labels, source);
  }
}

/** Export verified content identities, independently of development tags. */
export async function exportImages({ projectDir, outputDir, runtime }: ExportOptions): Promise<void> {
  if (!['docker', 'podman'].includes(runtime)) throw new Error('Container runtime must be docker or podman');
  const saved = JSON.parse(await readFile(resolve(projectDir, '.ams/images.json'), 'utf8')) as ImageManifest;
  const env = await readEnv(resolve(projectDir, '.env'));
  // Standalone image builds have no deployment settings; retain their complete export contract.
  const required = Object.keys(env).length ? resolveDeployment(env, { requireConnections: false }).requiredImages : undefined;
  if (!saved || saved.schemaVersion !== 1 || !saved.images || typeof saved.images !== 'object' || Array.isArray(saved.images)) throw new Error('Invalid image manifest');
  const manifest = required
    ? validateDeploymentImages({ schemaVersion: saved.schemaVersion, images: Object.fromEntries(required.map(service => [service, saved.images[service]])) }, required)
    : validateImageManifest(saved, false);
  if (!Object.keys(manifest.images).length) throw new Error('Cannot export an empty image manifest');
  const source = includesTdai(manifest) ? validateTdaiSource((await loadSourceLock(projectDir)).sources.tencent) : undefined;
  verifyLocalImages(runtime, manifest, source);
  await mkdir(dirname(resolve(outputDir)), { recursive: true });
  await mkdir(outputDir, { recursive: false });
  const archive = resolve(outputDir, 'images.tar');
  const ids = [...new Set(imageServices.filter(service => manifest.images[service]).map(service => manifest.images[service]!.id))];
  const args = ['save', '--output', archive];
  if (runtime === 'podman') args.push('--format', 'docker-archive', '--multi-image-archive');
  await run(runtime, [...args, ...ids]);
  verifyArchiveImages(archive, manifest, source);
  await writeFile(resolve(outputDir, 'images.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const metadata: BundleMetadata = { schemaVersion: 1, archiveSha256: await fileHash(archive), manifestSha256: await fileHash(resolve(outputDir, 'images.json')) };
  if (source) {
    await writeFile(resolve(outputDir, 'tdai-source.json'), `${JSON.stringify(source, null, 2)}\n`);
    metadata.tdaiSourceSha256 = await fileHash(resolve(outputDir, 'tdai-source.json'));
  }
  // Write the completion marker last; an interrupted export cannot be loaded.
  await writeFile(resolve(outputDir, 'bundle.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Verified image bundle saved in ${outputDir}`);
}

/** Validate bytes and native platform before importing; never delete existing images. */
export async function loadImages({ bundleDir, projectDir, runtime, platform }: LoadOptions): Promise<ImageManifest> {
  const metadata = JSON.parse(await readFile(resolve(bundleDir, 'bundle.json'), 'utf8')) as BundleMetadata;
  if (metadata.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(metadata.archiveSha256) || !/^[a-f0-9]{64}$/.test(metadata.manifestSha256)) throw new Error('Invalid image bundle metadata');
  const archive = resolve(bundleDir, 'images.tar');
  if (await fileHash(archive) !== metadata.archiveSha256 || await fileHash(resolve(bundleDir, 'images.json')) !== metadata.manifestSha256) throw new Error('Image bundle checksum mismatch');
  let source: SourceLock | undefined;
  if (metadata.tdaiSourceSha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(metadata.tdaiSourceSha256)) throw new Error('Invalid image bundle source metadata');
    const sourceBytes = await readFile(resolve(bundleDir, 'tdai-source.json'));
    if (createHash('sha256').update(sourceBytes).digest('hex') !== metadata.tdaiSourceSha256) throw new Error('Image bundle source checksum mismatch');
    source = validateTdaiSource(JSON.parse(sourceBytes.toString('utf8')));
  }
  const actualPlatform = runtimePlatform(runtime);
  if (platform && platform !== actualPlatform) throw new Error(`Container runtime is ${actualPlatform}, requested ${platform}`);
  const manifest = validateImageManifest(JSON.parse(await readFile(resolve(bundleDir, 'images.json'), 'utf8')), false, actualPlatform);
  if (!Object.keys(manifest.images).length) throw new Error('Cannot load an empty image manifest');
  // Legacy bundles used the packaged source; verify that assumption against image labels.
  if (includesTdai(manifest)) source ??= validateTdaiSource((await loadSourceLock()).sources.tencent);
  else source = undefined;
  verifyArchiveImages(archive, manifest, source);
  await run(runtime, ['load', '--input', archive]);
  verifyLocalImages(runtime, manifest, source);
  if (source) {
    await preserveInputs(projectDir);
    await atomicWrite(resolve(projectDir, '.ams/tdai-source.json'), `${JSON.stringify(source, null, 2)}\n`);
  }
  await writeImageManifest(projectDir, manifest);
  console.log(`Loaded and verified ${Object.keys(manifest.images).length} images by content identity`);
  return manifest;
}
