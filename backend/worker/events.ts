import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { DataSection, MonitorEvent } from '../../shared/api.js';
import { MAX_EVENTS } from '../../shared/config.js';
import { source } from '../observation.js';
import { WorkerFiles, ReadFailure } from './files.js';
import { id, object, parseBoundedJson, stamp } from './validation.js';

// Verified emitters: store.py, service.py, claims.py, checkpoints.py, workflow.py.
const TYPES: Record<string, [MonitorEvent['severity'], string]> = {
  'worker-started': ['info', 'Worker service started'], 'worker-stopped': ['info', 'Worker service stopped'],
  'worker-state': ['info', 'Worker service state changed'], 'worker-agent-started': ['info', 'Agent launch started'],
  'worker-agent-stopped': ['info', 'Agent launch ended'], 'worker-attention-required': ['error', 'Operator attention required'],
  'worker-subscription-unavailable': ['warning', 'Waiting for subscription availability'], 'worker-retry-scheduled': ['warning', 'Retry scheduled'],
  'worker-task-verified': ['info', 'Task verified'], 'worker-task-selected': ['info', 'Task selected'],
  'worker-cycle-failed': ['error', 'Worker cycle failed'], 'worker-recovered': ['warning', 'Worker recovery recorded'],
  'worker-recovery-done': ['info', 'Worker recovery completed'], 'worker-orphans-stopped': ['warning', 'Worker orphan cleanup recorded'],
  'worker-leftovers-stopped': ['warning', 'Worker launch cleanup recorded'],
  'worker-outcome': ['info', 'Launch outcome recorded'], 'worker-watchdog-stale': ['warning', 'Launch heartbeat is stale'],
  'worker-watchdog-hung': ['error', 'Worker watchdog reported a hung launch'], 'worker-watchdog-terminated': ['warning', 'Worker watchdog termination recorded'],
  'claim': ['info', 'Task claimed'], 'release': ['info', 'Task claim released'], 'recovered': ['warning', 'Task recovery recorded'],
  'recovery-refused': ['error', 'Task recovery refused'], 'checkpoint-intent': ['info', 'Checkpoint intent recorded'],
  'checkpoint-committed': ['info', 'Checkpoint committed'], 'checkpoint-no-changes': ['info', 'Step completed without changes'],
  'checkpoint-abandoned': ['warning', 'Checkpoint abandoned'], 'checkpoints-superseded': ['warning', 'Checkpoints superseded'],
  'worker-control': ['info', 'Operator control request recorded'],
};
export function parseEvent(value: unknown, hash: string): MonitorEvent | null {
  const record = object(value), at = stamp(record.at);
  const type = typeof record.kind === 'string' && Object.hasOwn(TYPES, record.kind) ? record.kind : null;
  if (!at || !type) return null;
  const reference = (value: unknown): string | null => { try { return id(value); } catch { return null; } };
  const [severity, summary] = TYPES[type]!;
  // Free-text event payloads are intentionally never projected, including reason/message/log.
  return { id: hash, at, type, severity, summary, featureId: reference(record.feature), taskId: reference(record.task) };
}

export class EventTailer {
  private identity = '';
  private offset = 0;
  private prefix = Buffer.alloc(0);
  private carry = '';
  private skipping = false;
  private seen = new Set<string>();
  private items: MonitorEvent[] = [];
  private lastSuccess: string | null = null;
  private decoder = new StringDecoder('utf8');

  reset(): void { this.identity = ''; this.offset = 0; this.prefix = Buffer.alloc(0); this.carry = ''; this.skipping = false; this.seen.clear(); this.items = []; this.lastSuccess = null; this.decoder = new StringDecoder('utf8'); }
  unavailable(now: number, detail: string): DataSection<MonitorEvent> {
    return { source: source(this.lastSuccess ? 'stale' : 'unavailable', this.lastSuccess, detail, now), items: [...this.items], truncated: false };
  }
  async collect(files: WorkerFiles, now = Date.now()): Promise<DataSection<MonitorEvent>> {
    let handle;
    try {
      handle = await files.eventFile();
      const info = await handle.stat(), key = `${files.identity}:${info.dev}:${info.ino}`;
      const prefix = Buffer.alloc(Math.min(info.size, 64));
      await handle.read(prefix, 0, prefix.length, 0);
      let truncated = false, invalid = 0;
      if (key !== this.identity || info.size < this.offset || !prefix.subarray(0, this.prefix.length).equals(this.prefix)) {
        this.offset = Math.max(0, info.size - 128 * 1024);
        this.carry = ''; this.skipping = this.offset > 0; this.decoder = new StringDecoder('utf8');
        this.identity = key;
      }
      this.prefix = prefix;
      const length = Math.min(128 * 1024, Math.max(0, info.size - this.offset));
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
      this.offset += bytesRead;
      truncated = this.offset < info.size || info.size > 128 * 1024;
      // Bytes beyond the per-cycle cap are processed on the next collection.
      const text = this.carry + this.decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split('\n'); this.carry = lines.pop() ?? '';
      for (const line of lines) {
        files.checkBudget();
        if (this.skipping) { this.skipping = false; continue; }
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > 16 * 1024) { invalid++; continue; }
        const hash = createHash('sha256').update(line).digest('hex').slice(0, 24);
        if (this.seen.has(hash)) continue;
        try {
          const event = parseEvent(parseBoundedJson(line), hash);
          if (!event) { invalid++; continue; }
          this.seen.add(hash);
          if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
          this.items.unshift(event);
        } catch { invalid++; }
      }
      if (Buffer.byteLength(this.carry) > 16 * 1024) { this.carry = ''; this.skipping = true; invalid++; }
      this.items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      this.items = this.items.slice(0, MAX_EVENTS);
      this.lastSuccess = new Date(now).toISOString();
      return { source: source(invalid ? 'stale' : 'ok', this.lastSuccess, invalid ? `${invalid} malformed, unsupported, or oversized event lines omitted this cycle.` : null, now), items: [...this.items], truncated: truncated || this.seen.size > MAX_EVENTS };
    } catch (error) {
      const missing = error instanceof ReadFailure && error.kind === 'missing';
      return { source: source(this.lastSuccess ? 'stale' : missing ? 'unavailable' : 'error', this.lastSuccess, missing ? 'Events source is absent.' : 'Events source could not be safely read.', now), items: [...this.items], truncated: false };
    } finally { await handle?.close(); }
  }
}
