import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { StreamEnvelope } from '../shared/api.js';
import { MAX_STREAM_PENDING_BYTES, MAX_STREAM_SUBSCRIBERS } from '../shared/config.js';
import { Monitor } from './monitor.js';

export interface StreamSink { writableLength: number; destroyed: boolean; write(frame: string): boolean; destroy(): unknown }
export function writeStream(response: StreamSink, frame: string): boolean {
  if (response.destroyed) return false;
  try {
    if (response.writableLength + Buffer.byteLength(frame) > MAX_STREAM_PENDING_BYTES) { response.destroy(); return false; }
    // A false return is a normal high-water mark, including for large initial
    // snapshots. Node owns that bounded queue; no application-side copies accumulate.
    response.write(frame); return true;
  } catch { response.destroy(); return false; }
}

export class MonitorStream {
  private clients = new Set<ServerResponse>();
  private ready = new Set<ServerResponse>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private sequence = 0;
  private closed = false;
  private readonly serverId = randomUUID();
  constructor(private readonly monitor: Monitor, private readonly heartbeatMs = 15_000) {}

  async subscribe(reply: FastifyReply): Promise<void> {
    if (this.closed || this.clients.size >= MAX_STREAM_SUBSCRIBERS) { reply.code(503).send({ error: 'Monitoring stream subscriber limit reached.' }); return; }
    // Reserve capacity before awaiting the shared initial collection.
    const response = reply.raw;
    this.clients.add(response); this.monitor.setSubscribers(this.clients.size);
    const cleanup = (): void => {
      this.clients.delete(response); this.monitor.setSubscribers(this.clients.size);
      this.ready.delete(response);
      if (!this.clients.size) { clearTimeout(this.timer); this.timer = undefined; clearInterval(this.heartbeat); this.heartbeat = undefined; }
    };
    response.once('close', cleanup);
    response.once('error', () => { response.destroy(); cleanup(); });
    try {
      const snapshot = await this.monitor.getSnapshot();
      if (this.closed || response.destroyed) { cleanup(); return; }
      reply.hijack();
      for (const [key, value] of Object.entries(reply.getHeaders())) if (value !== undefined) response.setHeader(key, value);
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      this.ready.add(response);
      const envelope: StreamEnvelope = { schemaVersion: 1, sequence: ++this.sequence, serverId: this.serverId, at: new Date().toISOString(), snapshot };
      writeStream(response, `retry: 1000\nid: ${envelope.sequence}\nevent: snapshot\ndata: ${JSON.stringify(envelope)}\n\n`);
      this.start();
    } catch { cleanup(); if (!response.destroyed) reply.code(503).send({ error: 'Monitoring snapshot unavailable.' }); }
  }
  private start(): void {
    if (this.closed || !this.clients.size) return;
    if (!this.heartbeat) this.heartbeat = setInterval(() => {
      const frame = `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString(), sequence: this.sequence })}\n\n`;
      for (const client of this.ready) writeStream(client, frame);
    }, this.heartbeatMs);
    if (!this.timer && !this.pending) this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = this.publish().catch(() => { /* Heartbeat continues; stale age remains visible until the next successful collection. */ }).finally(() => { this.pending = undefined; this.start(); });
    }, this.monitor.sampleMs);
  }
  private async publish(): Promise<void> {
    const snapshot = await this.monitor.getSnapshot();
    if (this.closed || !this.clients.size) return;
    const envelope: StreamEnvelope = { schemaVersion: 1, sequence: ++this.sequence, serverId: this.serverId, at: new Date().toISOString(), snapshot };
    const frame = `id: ${envelope.sequence}\nevent: snapshot\ndata: ${JSON.stringify(envelope)}\n\n`;
    for (const client of this.ready) writeStream(client, frame);
  }
  async close(): Promise<void> {
    this.closed = true; clearTimeout(this.timer); clearInterval(this.heartbeat);
    for (const client of this.clients) client.destroy();
    this.clients.clear(); this.ready.clear(); this.monitor.setSubscribers(0);
    await this.pending; await this.monitor.close();
  }
}

export function installMonitorStream(app: FastifyInstance, monitor: Monitor, heartbeatMs?: number): MonitorStream {
  const stream = new MonitorStream(monitor, heartbeatMs);
  app.get('/api/stream', (_request, reply) => stream.subscribe(reply));
  app.addHook('preClose', () => stream.close());
  return stream;
}
