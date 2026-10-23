import { APP_ID, ENV_PREFIX, parsePort, vitePort, parseInterval, MACHINE_SAMPLE_MS, TASK_SAMPLE_MS, WORKER_STALE_MS } from '../shared/config.js';
import type { HealthResponse } from '../shared/api.js';

export function runtimeOptions(env = process.env, argv = process.argv.slice(2)) {
  const allowed = new Set(['--no-open']);
  let workerStateDir = env[`${ENV_PREFIX}_WORKER_STATE_DIR`];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === '--worker-state-dir') {
      workerStateDir = argv[++index];
      if (!workerStateDir || workerStateDir.startsWith('--')) throw new Error('--worker-state-dir requires a directory.');
    } else if (!allowed.has(argument)) throw new Error('Unknown argument. Use --no-open or --worker-state-dir <directory>.');
  }
  if (workerStateDir !== undefined && (!workerStateDir.trim() || workerStateDir.includes('\0') || Buffer.byteLength(workerStateDir) > 4096)) {
    throw new Error('Worker state directory must be a nonempty filesystem path without NUL characters.');
  }
  const port = parsePort(env.PORT);
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('HOST must be 127.0.0.1 or 0.0.0.0.');
  const dev = env[`${ENV_PREFIX}_DEV`] === '1';
  const defaultUrl = `http://127.0.0.1:${dev ? vitePort(env.PORT) : port}`;
  const openUrl = env[`${ENV_PREFIX}_OPEN_URL`] ?? defaultUrl;
  const url = new URL(openUrl);
  if (url.origin !== defaultUrl || url.username || url.password) throw new Error('OPEN_URL must use the local application origin.');
  const sampleMs = parseInterval(env[`${ENV_PREFIX}_SAMPLE_MS`], MACHINE_SAMPLE_MS, 250, 10_000);
  const taskSampleMs = parseInterval(env[`${ENV_PREFIX}_TASK_SAMPLE_MS`], TASK_SAMPLE_MS, 500, 60_000);
  const staleMs = parseInterval(env[`${ENV_PREFIX}_WORKER_STALE_MS`], WORKER_STALE_MS, 1_000, 3_600_000);
  return { port, host, dev, openUrl, sampleMs, taskSampleMs, staleMs, noOpen: argv.includes('--no-open') || env[`${ENV_PREFIX}_NO_OPEN`] === '1', workerStateDir };
}

export async function existingInstance(port: number): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500), redirect: 'error', cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const value = body as Record<string, unknown>;
    if (value.appId !== APP_ID || value.status !== 'ok' || typeof value.dev !== 'boolean' || typeof value.version !== 'string') return null;
    return value as unknown as HealthResponse;
  } catch { return null; }
}
