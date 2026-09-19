import { isAbsolute, normalize } from 'node:path';
import { serviceNames } from '../deployment/model.js';
import { ProcessFailure, runProcess } from './process.js';
import type { Runner } from './process.js';

export type ExistingInstallation = { engine: 'docker' | 'podman'; project: string; directory?: string; nativeRoot?: string };

function directoryLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 4096 && isAbsolute(value) && normalize(value) === value
    && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value) ? value : undefined;
}

/** Best-effort detection of complete stacks visible through the current user's engines. */
export async function detectExistingInstallation(run: Runner = runProcess): Promise<ExistingInstallation | undefined> {
  const results = await Promise.all((['docker', 'podman'] as const).map(async engine => {
    let output: string;
    try {
      const ids = (await run({ command: engine, args: ['ps', '-aq'], label: 'Find existing stack containers', timeoutMs: 5000 })).trim().split(/\s+/).filter(Boolean);
      if (!ids.length || ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) return undefined;
      output = await run({ command: engine, args: ['inspect', ...ids], label: 'Read existing stack labels', timeoutMs: 5000 });
    } catch (error) {
      if (error instanceof ProcessFailure) return undefined;
      throw error;
    }
    let containers: unknown;
    try { containers = JSON.parse(output); } catch { return undefined; }
    if (!Array.isArray(containers)) return undefined;
    const groups = new Map<string, { services: Set<string>; directories: Set<string>; nativeRoots: Set<string> }>();
    for (const container of containers) {
      const labels = container?.Config?.Labels;
      if (!labels || typeof labels !== 'object' || Array.isArray(labels)) continue;
      const project: unknown = labels['com.docker.compose.project'];
      const service: unknown = labels['com.docker.compose.service'];
      if (typeof project !== 'string' || !/^ams-[a-f0-9]{10}$/.test(project)
        || typeof service !== 'string' || !serviceNames.some(name => name === service)) continue;
      const group = groups.get(project) ?? { services: new Set<string>(), directories: new Set<string>(), nativeRoots: new Set<string>() };
      group.services.add(service);
      const nativeRoot = directoryLabel(labels['io.agent-memory-stack.native-config']);
      if (nativeRoot) group.nativeRoots.add(nativeRoot);
      for (const key of ['com.docker.compose.project.working_dir', 'io.podman.compose.project.working_dir']) {
        const directory = directoryLabel(labels[key]);
        if (directory) group.directories.add(directory);
      }
      groups.set(project, group);
    }
    for (const [project, group] of groups) if (serviceNames.filter(service => service !== 'mcp').every(service => group.services.has(service))) {
      return { engine, project, ...(group.nativeRoots.size === 1 ? { nativeRoot: [...group.nativeRoots][0] } : {}), ...(group.directories.size === 1 ? { directory: [...group.directories][0] } : {}) };
    }
    return undefined;
  }));
  return results.find(result => result !== undefined);
}
