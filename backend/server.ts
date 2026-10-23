import Fastify from 'fastify';
import type { ApiError, HealthResponse, SessionResponse } from '../shared/api.js';
import { APP_ID } from '../shared/config.js';
import pkg from '../package.json' with { type: 'json' };
import { assets as embeddedAssets, type EmbeddedAsset } from './embedded.js';
import { allowedHost, HARDENED_HEADERS, installSecurity } from './security.js';
import { installLifecycle } from './lifecycle.js';
import { Monitor } from './monitor.js';
import { W4WorkerStateAdapter } from './collectors/worker-state.js';
import { installMonitorStream } from './monitor-stream.js';

export interface ServerOptions {
  dev?: boolean;
  onShutdown?: () => void;
  workerStateDir?: string;
  assets?: Readonly<Record<string, EmbeddedAsset>>;
  sampleMs?: number;
  taskSampleMs?: number;
  staleMs?: number;
  monitor?: Monitor;
  heartbeatMs?: number;
}

export async function createServer(options: ServerOptions = {}) {
  const app = Fastify({
    logger: false, bodyLimit: 1024, requestTimeout: 10_000, forceCloseConnections: true,
    // Router errors occur before onRequest hooks; harden and sanitize those too.
    frameworkErrors(_error, request, reply) {
      const status = allowedHost(request.headers.host) ? 400 : 403;
      const body: ApiError = { error: status === 403 ? 'Forbidden host.' : 'Invalid request.' };
      reply.hijack();
      reply.raw.writeHead(status, { ...HARDENED_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      reply.raw.end(JSON.stringify(body));
    },
  });
  const setSession = installSecurity(app);
  const monitor = options.monitor ?? new Monitor(new W4WorkerStateAdapter(options.workerStateDir, options.taskSampleMs), undefined,
    { ...(options.sampleMs === undefined ? {} : { sampleMs: options.sampleMs }), ...(options.staleMs === undefined ? {} : { staleMs: options.staleMs }) });
  const assets = options.assets ?? embeddedAssets;
  app.get('/api/health', (): HealthResponse => ({ appId: APP_ID, version: pkg.version, status: 'ok', dev: options.dev ?? false }));
  app.get('/api/session', (_request, reply): SessionResponse => {
    setSession(reply);
    return { authenticated: true };
  });
  app.get('/api/snapshot', () => monitor.getSnapshot());
  installLifecycle(app, options.onShutdown);
  installMonitorStream(app, monitor, options.heartbeatMs);

  app.get('/*', (request, reply) => {
    let path: string;
    try { path = decodeURIComponent(request.url.split('?')[0]!); }
    catch { return reply.code(400).send({ error: 'Invalid path.' }); }
    if (path.split('/').some(part => part === '..' || part === '.') || path.includes('\\') || path.includes('\0')) {
      return reply.code(400).send({ error: 'Invalid path.' });
    }
    if (path === '/api' || path.startsWith('/api/')) return reply.code(404).send({ error: 'API endpoint not found.' });
    const navigation = request.headers.accept?.includes('text/html') && !path.split('/').at(-1)?.includes('.');
    const key = path === '/' ? '/index.html' : path;
    const asset = Object.hasOwn(assets, key) ? assets[key] : navigation ? assets['/index.html'] : undefined;
    if (!asset) return reply.code(404).send({ error: 'Asset not found. Build the app or use the Vite dev server.' });
    return reply.type(asset.mime).send(Buffer.from(asset.base64, 'base64'));
  });
  app.setErrorHandler((_error, _request, reply) => {
    reply.code(500).send({ error: 'The Monitor could not complete this request.' });
  });
  return app;
}
