import { parseArgs } from 'node:util';
import { buildImages } from './images.js';
import type { ContainerRuntime, ImagePlatform } from './images.js';
import { fetchSources } from './sources.js';
import { exportImages, loadImages } from './bundle.js';

try {
  const { values } = parseArgs({ options: { runtime: { type: 'string', default: 'docker' }, platform: { type: 'string' }, 'project-dir': { type: 'string', default: process.cwd() }, fetch: { type: 'boolean', default: false }, export: { type: 'string' }, load: { type: 'string' } }, allowPositionals: false });
  if (!['docker', 'podman'].includes(values.runtime)) throw new Error('Container runtime must be docker or podman');
  if ([values.fetch, values.export, values.load].filter(Boolean).length > 1) throw new Error('Choose one action: --fetch, --export, or --load');
  if (values.fetch) await fetchSources(values['project-dir']);
  else if (values.export) await exportImages({ projectDir: values['project-dir'], outputDir: values.export, runtime: values.runtime as ContainerRuntime });
  else if (values.load) await loadImages({ projectDir: values['project-dir'], bundleDir: values.load, runtime: values.runtime as ContainerRuntime, platform: values.platform as ImagePlatform | undefined });
  else {
    await buildImages({ projectDir: values['project-dir'], runtime: values.runtime as ContainerRuntime, platform: values.platform as ImagePlatform | undefined });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Build failed');
  process.exitCode = 1;
}
