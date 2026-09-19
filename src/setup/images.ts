import { readFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildImages, imageServices, validateDeploymentImages, validateImageManifest } from '../build/images.js';
import type { ContainerRuntime, ImageManifest, ImagePlatform, ImageService } from '../build/images.js';
import { DeploymentError } from '../runtime/errors.js';
import { runProcess } from '../runtime/process.js';
import type { Runner } from '../runtime/process.js';
import { atomicWrite } from '../config/files.js';
import { validateTdaiSource, type SourceLock } from '../build/sources.js';
import { buildFingerprint, buildFingerprintLabel } from '../build/fingerprint.js';

export interface PrepareImagesOptions {
  projectDir: string;
  source?: SourceLock;
  runtime: ContainerRuntime;
  note?: (message: string) => void;
}

export interface ImagePreparationDependencies {
  run?: Runner;
  build?: typeof buildImages;
}

async function enginePlatform(runtime: ContainerRuntime, run: Runner): Promise<ImagePlatform> {
  let info: { OSType?: string; Architecture?: string; host?: { os?: string; arch?: string } };
  try {
    info = JSON.parse(await run({ command: runtime, args: ['info', '--format', '{{json .}}'] }));
  } catch {
    throw new DeploymentError(`Cannot read ${runtime} engine information. Start ${runtime === 'docker' ? 'Docker' : 'the Podman machine or service'} and check '${runtime} info', then run setup again.`);
  }
  const os = runtime === 'podman' ? info?.host?.os : info?.OSType;
  const rawArch = runtime === 'podman' ? info?.host?.arch : info?.Architecture;
  const arch = rawArch === 'x86_64' ? 'amd64' : rawArch === 'aarch64' ? 'arm64' : rawArch;
  const platform = `${os}/${arch}`;
  if (platform !== 'linux/amd64' && platform !== 'linux/arm64') {
    throw new DeploymentError(`Unsupported ${runtime} engine platform: ${platform}. Use a Linux amd64 or arm64 container engine.`);
  }
  return platform;
}

/** Reuse only verified images built from current inputs; retain installation metadata. */
export async function prepareImages(options: PrepareImagesOptions, dependencies: ImagePreparationDependencies = {}): Promise<ImageManifest> {
  if (!options.source) {
    try { options = { ...options, source: validateTdaiSource(JSON.parse(await readFile(resolve(options.projectDir, '.ams/pending-tdai-source.json'), 'utf8'))) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (options.source) {
    const stage = resolve(options.projectDir, '.ams/build-candidates', options.source.revision);
    await mkdir(resolve(stage, '.ams'), { recursive: true, mode: 0o700 });
    await atomicWrite(resolve(stage, '.ams/tdai-source.json'), JSON.stringify(options.source));
    for (const name of ['pending-images.json', 'images.json']) {
      try { await copyFile(resolve(options.projectDir, '.ams', name), resolve(stage, '.ams/images.json')); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const cache = resolve(options.projectDir, '.ams-build/.cache/upstream');
    const destination = resolve(stage, '.ams-build/.cache/upstream');
    await mkdir(destination, { recursive: true });
    try { for (const name of await readdir(cache)) if (/^[a-z]+-[a-f0-9]{40}\.tar\.gz$/.test(name)) await copyFile(resolve(cache, name), resolve(destination, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return prepareImages({ ...options, projectDir: stage, source: undefined }, dependencies);
  }
  const { projectDir, runtime, note } = options;
  const required = imageServices;
  if (!['docker', 'podman'].includes(runtime)) throw new DeploymentError('Container runtime must be docker or podman');
  const run = dependencies.run ?? runProcess;
  const platform = await enginePlatform(runtime, run);
  let manifestPath = resolve(projectDir, '.ams/pending-images.json');
  try { await readFile(manifestPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; manifestPath = resolve(projectDir, '.ams/images.json'); }
  let manifest: ImageManifest = { schemaVersion: 1, images: {} };
  try {
    manifest = validateImageManifest(JSON.parse(await readFile(manifestPath, 'utf8')), false, platform);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new DeploymentError(`Cannot reuse image metadata at ${manifestPath}: ${error instanceof Error ? error.message : 'invalid manifest'}. Restore valid image metadata before retrying ams apply.`);
    }
  }

  const missing: ImageService[] = [];
  for (const service of required) {
    const identity = manifest.images[service];
    if (!identity) { missing.push(service); continue; }
    let output: string;
    try {
      output = await run({ command: runtime, args: ['image', 'inspect', identity.id] });
    } catch {
      // Distinguish an absent local image from an unavailable engine before rebuilding.
      await enginePlatform(runtime, run);
      missing.push(service);
      continue;
    }
    let inspection: { Id?: string; Os?: string; Architecture?: string; Config?: { Labels?: Record<string, string> } } | undefined;
    try { [inspection] = JSON.parse(output); } catch { /* Report the same actionable identity error below. */ }
    const rawId = inspection?.Id;
    const id = typeof rawId === 'string' ? (rawId.startsWith('sha256:') ? rawId : `sha256:${rawId}`) : undefined;
    if (id !== identity.id || `${inspection?.Os}/${inspection?.Architecture}` !== identity.platform) {
      throw new DeploymentError(`Image verification failed for ${service}: ${runtime} image ID or platform does not match saved metadata. Restore the original image before retrying ams apply.`);
    }
    if (inspection?.Config?.Labels?.[buildFingerprintLabel] !== await buildFingerprint(service, undefined, projectDir)) {
      missing.push(service);
      note?.(`Rebuilding ${service}: its image differs from the current build inputs.`);
      continue;
    }
    note?.(`Reusing ${service} (${platform}).`);
  }
  if (missing.length) {
    note?.(`Building missing or outdated images: ${missing.join(', ')} (${platform}). The first build downloads sources and dependencies and can take several minutes.`);
    manifest = await (dependencies.build ?? buildImages)({ projectDir, runtime, platform, services: missing, manifest, persist: false });
  }
  return validateDeploymentImages(manifest, platform);
}
