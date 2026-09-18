import { DeploymentError } from "../runtime/errors.js";
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildContext, fetchSources, loadSourceLock, packageRoot } from './sources.js';
import { buildFingerprint, buildFingerprintLabel, contextPackageJson } from './fingerprint.js';

export const imageServices = ['core', 'knowledge', 'panel', 'memory-proxy', 'cli-proxy-api', 'mcp', 'runtime'] as const;
export type ImageService = typeof imageServices[number];
export type ContainerRuntime = 'docker' | 'podman';
export type ImagePlatform = 'linux/amd64' | 'linux/arm64';
export interface ImageIdentity { id: string; tag: string; repoDigests: string[]; platform: ImagePlatform }
export interface ImageManifest { schemaVersion: 1; images: Partial<Record<ImageService, ImageIdentity>> }
export interface BuildOptions {
  projectDir: string;
  runtime: ContainerRuntime;
  platform?: ImagePlatform;
  services?: ImageService[];
  /** Setup supplies verified metadata and persists it with the installation configuration. */
  manifest?: ImageManifest;
  persist?: boolean;
}
const variables: Record<ImageService, string> = { core: 'CORE_IMAGE', knowledge: 'KNOWLEDGE_IMAGE', panel: 'PANEL_IMAGE', 'memory-proxy': 'PROXY_IMAGE', 'cli-proxy-api': 'CLIPROXY_IMAGE', mcp: 'MCP_IMAGE', runtime: 'RUNTIME_IMAGE' };

export function validateImageManifest(value: unknown, requireComplete = true, platform?: ImagePlatform): ImageManifest {
  const manifest = value as ImageManifest;
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.images || typeof manifest.images !== 'object' || Array.isArray(manifest.images)) throw new DeploymentError('Invalid image manifest');
  let expected = platform;
  for (const service of imageServices) {
    const image = manifest.images[service];
    if (!image) { if (requireComplete) throw new DeploymentError(`Missing image: ${service}`); continue; }
    if (!/^sha256:[a-f0-9]{64}$/.test(image.id) || typeof image.tag !== 'string' || !Array.isArray(image.repoDigests) || image.repoDigests.some(digest => typeof digest !== 'string' || !/@sha256:[a-f0-9]{64}$/.test(digest))) throw new DeploymentError(`Invalid image identity: ${service}`);
    if (!['linux/amd64', 'linux/arm64'].includes(image.platform)) throw new DeploymentError(`Unsupported image platform: ${service}`);
    expected ??= image.platform;
    if (image.platform !== expected) throw new DeploymentError(`Incompatible image platform: ${service} is ${image.platform}, expected ${expected}`);
  }
  return manifest;
}

/** Deployment checks inspect only the required images; archive validation stays independent. */
export function validateDeploymentImages(value: unknown, required: readonly ImageService[], platform?: ImagePlatform): ImageManifest {
  const manifest = validateImageManifest(value, false);
  if (!required.length || required.some(service => !imageServices.includes(service))) throw new DeploymentError('Invalid required image selection');
  for (const service of required) {
    const identity = manifest.images[service];
    if (!identity) throw new DeploymentError(`Missing image: ${service}`);
    if (platform && identity.platform !== platform) throw new DeploymentError(`Incompatible image platform: ${service} is ${identity.platform}, expected ${platform}`);
  }
  return manifest;
}

export async function writeImageManifest(projectDir: string, manifest: ImageManifest): Promise<void> {
  validateImageManifest(manifest, false);
  const output = resolve(projectDir, '.ams');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'images.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(output, 'images.env'), imageServices.filter(service => manifest.images[service]).map(service => `${variables[service]}=${manifest.images[service]!.id}`).join('\n') + '\n');
}

/** Prepare a dedicated context without copying caller .env, data, or checkout files. */
export async function prepareBuildContext(projectDir: string): Promise<string> {
  const context = buildContext(projectDir);
  await mkdir(context, { recursive: true });
  for (const resource of ['deploy', 'dist/runtime', 'dist/config', 'dist/build', 'dist/deployment']) {
    await rm(resolve(context, resource), { recursive: true, force: true });
    await cp(resolve(packageRoot, resource), resolve(context, resource), {
      recursive: true, filter: source => !resource.startsWith('dist/') || !source.endsWith('.map'),
    });
  }
  await writeFile(resolve(context, 'package.json'), contextPackageJson);
  await writeFile(resolve(context, '.dockerignore'), '**\n!deploy/\n!deploy/**\n!dist/\n!dist/runtime/\n!dist/runtime/**\n!dist/config/\n!dist/config/**\n!dist/build/\n!dist/build/**\n!dist/deployment/\n!dist/deployment/**\n!package.json\n!.cache/\n!.cache/upstream/\n!.cache/upstream/tencent/\n!.cache/upstream/tencent/**\n!.cache/upstream/cliproxy/\n!.cache/upstream/cliproxy/**\n**/node_modules\n**/.git\n**/.env\n**/.env.*\n**/.admin-key*\n**/config.local.*\n');
  return context;
}

export async function buildImages(options: BuildOptions): Promise<ImageManifest> {
  const { projectDir, runtime, platform } = options;
  const selected = options.services?.length ? [...new Set(options.services)] : [...imageServices];
  if (!['docker', 'podman'].includes(runtime)) throw new Error('Container runtime must be docker or podman');
  if (platform && !['linux/amd64', 'linux/arm64'].includes(platform)) throw new Error('Platform must be linux/amd64 or linux/arm64');
  if (selected.some(service => !imageServices.includes(service))) throw new Error('Unknown image service');
  const output = resolve(projectDir, '.ams');
  let manifest: ImageManifest = options.manifest ? structuredClone(validateImageManifest(options.manifest, false, platform)) : { schemaVersion: 1, images: {} };
  if (!options.manifest) {
    try { manifest = validateImageManifest(JSON.parse(await readFile(resolve(output, 'images.json'), 'utf8')), false); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // Full explicit builds can replace another architecture; partial builds retain a coherent set.
    if (selected.length === imageServices.length) manifest = { schemaVersion: 1, images: {} };
    else validateImageManifest(manifest, false, platform);
  }
  const context = await prepareBuildContext(projectDir);
  await fetchSources(projectDir);
  const sourceLock = await loadSourceLock(projectDir);
  for (const service of selected) {
    const nodeService = !['cli-proxy-api', 'runtime', 'mcp'].includes(service);
    const tag = `agent-memory-stack/${service}:local`;
    const fingerprint = await buildFingerprint(service, undefined, projectDir);
    const args = ['build', '--file', `deploy/${nodeService ? 'node' : service}.Dockerfile`, '--tag', tag,
      '--label', `${buildFingerprintLabel}=${fingerprint}`];
    if (nodeService) args.push('--target', service, '--build-arg', `TDAI_REVISION=${sourceLock.sources.tencent.revision}`);
    if (platform) args.push('--platform', platform);
    args.push('.');
    console.log(`Building ${service}${platform ? ` (${platform})` : ''}`);
    await new Promise<void>((resolveBuild, reject) => {
      const child = spawn(runtime, args, { cwd: context, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolveBuild() : reject(new Error(`${service} build failed (${code})`)));
    });
    const [inspection] = JSON.parse(execFileSync(runtime, ['image', 'inspect', tag], { encoding: 'utf8' })) as Array<{ Id: string; RepoDigests?: string[]; Os: string; Architecture: string }>;
    manifest.images[service] = {
      id: inspection.Id.startsWith('sha256:') ? inspection.Id : `sha256:${inspection.Id}`,
      tag,
      repoDigests: inspection.RepoDigests ?? [],
      platform: `${inspection.Os}/${inspection.Architecture}` as ImagePlatform,
    };
    validateImageManifest(manifest, false, platform);
  }
  if (options.persist !== false) {
    await writeImageManifest(projectDir, manifest);
    console.log(`Immutable image identities saved in ${output}/images.json and images.env`);
  }
  return manifest;
}
