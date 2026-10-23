import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { LifecycleEvent } from '../shared/api.js';
import { PageLifetime } from './page-lifetime.js';

export function installLifecycle(app: FastifyInstance, onShutdown?: () => void): void {
  const lifetime = new PageLifetime(onShutdown);
  const clients = new Set<ServerResponse>();
  app.get('/api/lifecycle', (request, reply) => {
    if (clients.size >= 64) return reply.code(503).send({ error: 'Too many lifecycle connections.' });
    reply.hijack();
    const response = reply.raw;
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) response.setHeader(name, value);
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    clients.add(response);
    const disconnect = lifetime.connect();
    const ready: LifecycleEvent = { connected: true };
    response.write(`retry: 1000\nevent: ready\ndata: ${JSON.stringify(ready)}\n\n`);
    const heartbeat = setInterval(() => {
      // Drop a slow client instead of retaining an unbounded output queue.
      if (response.writableLength > 16 * 1024 || !response.write(': heartbeat\n\n')) response.destroy();
    }, 15_000);
    const cleanup = (): void => {
      clearInterval(heartbeat);
      clients.delete(response);
      disconnect();
    };
    response.once('close', cleanup);
    request.raw.once('error', () => response.destroy());
  });
  app.addHook('preClose', async () => {
    lifetime.dispose();
    for (const client of clients) client.destroy();
    clients.clear();
  });
}
