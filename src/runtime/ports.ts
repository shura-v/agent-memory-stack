import { randomUUID } from 'node:crypto';
import type { ImageManifest } from '../build/images.js';
import { validateDeploymentImages } from '../build/images.js';
import type { ServiceInterface } from '../deployment/model.js';
import { DeploymentError, PortBindingConflict } from './errors.js';
import type { Runner } from './process.js';

export type PortReservation = { ports: Record<string, string>; release(): Promise<void> };
type Container = {
  Id: string;
  Config?: { Labels?: Record<string, string> };
  State?: { Running?: boolean; Status?: string };
  NetworkSettings?: { Ports?: Record<string, { HostIp: string; HostPort: string }[] | null> };
};
const operationLabel = 'io.agent-memory-stack.port-reservation';

/** Reserve on the actual engine, including Docker contexts and Podman machines. */
export async function reservePublishedPorts(engine: string, project: string, manifest: ImageManifest,
  interfaces: ServiceInterface[], run: Runner): Promise<PortReservation> {
  validateDeploymentImages(manifest, ['runtime']);
  if (!interfaces.length) return { ports: {}, async release() {} };
  const operation = randomUUID();
  const helpers = new Set<string>();
  const starts: Promise<string>[] = [];
  const ports: Record<string, string> = {};
  const used = new Set<number>();
  let released = false;
  let releasing: Promise<void> | undefined;
  const inspect = async (ids: string[]): Promise<Container[]> => {
    if (!ids.length) return [];
    try {
      const result: unknown = JSON.parse(await run({ command: engine, args: ['inspect', ...ids], label: 'Inspect published ports' }));
      if (!Array.isArray(result)) throw new Error();
      return result as Container[];
    } catch {
      throw new DeploymentError('Cannot inspect container port bindings in the selected engine');
    }
  };
  const ids = async (args: string[]) => (await run({ command: engine, args: ['ps', ...args], label: 'Inspect port reservation containers' })).trim().split(/\s+/).filter(Boolean);
  const running = await inspect(await ids(['-q']));
  const bindings = (container: Container, target: number) => container.NetworkSettings?.Ports?.[`${target}/tcp`] ?? [];
  const removeSignals = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
  const release = (): Promise<void> => {
    if (released) return Promise.resolve();
    if (releasing) return releasing;
    releasing = (async () => {
      try {
        await Promise.allSettled(starts);
        if (helpers.size) {
          const candidates = await inspect(await ids(['-aq', '--filter', `label=${operationLabel}=${operation}`]));
          const owned = candidates.filter(container => container.Config?.Labels?.[operationLabel] === operation
            && container.Config.Labels['com.docker.compose.project'] === project);
          if (owned.length) await run({ command: engine, args: ['rm', '-f', ...owned.map(container => container.Id)], label: 'Release temporary port reservations' });
        }
        released = true;
      } finally { removeSignals(); }
    })();
    return releasing;
  };
  const signal = (code: number) => { void release().finally(() => process.exit(code)); };
  const interrupt = () => signal(130);
  const terminate = () => signal(143);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    for (const item of interfaces) {
      if (!Number.isInteger(item.port) || item.port < 1 || item.port > 65535) throw new DeploymentError(`Invalid preferred port for ${item.service}`);
      const owned = running.some(container => container.Config?.Labels?.['com.docker.compose.project'] === project
        && container.Config.Labels['com.docker.compose.service'] === item.service
        && (container.State?.Running || container.State?.Status === 'running')
        && bindings(container, item.target).some(binding => binding.HostIp === '127.0.0.1' && Number(binding.HostPort) === item.port));
      if (owned && !used.has(item.port)) {
        used.add(item.port);
        ports[item.field] = String(item.port);
        continue;
      }
      const reserve = async (preferred?: number): Promise<number> => {
        if (releasing) throw new DeploymentError('Port allocation was cancelled');
        const name = `${project}-port-${operation}-${helpers.size}`;
        helpers.add(name);
        const starting = run({ command: engine, args: ['run', '--detach', '--pull=never', '--name', name,
          '--label', `com.docker.compose.project=${project}`, '--label', `${operationLabel}=${operation}`,
          '--publish', `127.0.0.1:${preferred ?? ''}:${item.target}`, manifest.images.runtime!.id,
          '-e', `require('node:net').createServer().listen(${item.target},'0.0.0.0')`],
        label: `Reserve ${item.service} host port`, classifyPortConflict: true });
        starts.push(starting);
        await starting;
        if (releasing) throw new DeploymentError('Port allocation was cancelled');
        const [container] = await inspect([name]);
        const published = container && bindings(container, item.target);
        const port = published?.length === 1 && published[0].HostIp === '127.0.0.1' ? Number(published[0].HostPort) : NaN;
        if (!container || !(container.State?.Running || container.State?.Status === 'running')
          || !Number.isInteger(port) || port < 1 || port > 65535 || (preferred !== undefined && port !== preferred) || used.has(port)) {
          throw new DeploymentError(`Cannot verify the reserved loopback port for ${item.service}`);
        }
        return port;
      };
      let port: number;
      if (used.has(item.port)) port = await reserve();
      else {
        try { port = await reserve(item.port); }
        catch (error) {
          if (!(error instanceof PortBindingConflict)) throw error;
          port = await reserve();
        }
      }
      used.add(port);
      ports[item.field] = String(port);
    }
    return { ports, release };
  } catch (error) {
    await release();
    throw error;
  }
}
