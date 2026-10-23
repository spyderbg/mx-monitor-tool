import type { MonitorSnapshot, StreamEnvelope } from '../../shared/api.js';

export function isSnapshot(value: unknown): value is MonitorSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MonitorSnapshot>;
  return record.schemaVersion === 1 && Number.isSafeInteger(record.revision) && typeof record.observedAt === 'string' && Number.isFinite(Date.parse(record.observedAt)) &&
    !!record.machine && !!record.worker && !!record.tasks && Array.isArray(record.tasks.items) && !!record.processes && Array.isArray(record.processes.items) &&
    !!record.events && Array.isArray(record.events.items) && !!record.features && Array.isArray(record.features.items);
}
export class StreamState {
  private serverId: string | null = null;
  private sequence = 0;
  private revision = 0;
  fromHttp(value: unknown): MonitorSnapshot | null {
    if (!isSnapshot(value) || value.revision < this.revision) return null;
    this.revision = value.revision; return value;
  }
  accept(value: unknown): MonitorSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const envelope = value as Partial<StreamEnvelope>;
    if (envelope.schemaVersion !== 1 || typeof envelope.serverId !== 'string' || !Number.isSafeInteger(envelope.sequence) || envelope.sequence! <= 0 || !isSnapshot(envelope.snapshot)) return null;
    if (envelope.serverId !== this.serverId) {
      if (this.serverId !== null) this.revision = 0;
      this.serverId = envelope.serverId; this.sequence = 0;
    }
    if (envelope.sequence! <= this.sequence || envelope.snapshot.revision < this.revision) return null;
    this.sequence = envelope.sequence!; this.revision = envelope.snapshot.revision;
    return envelope.snapshot;
  }
}
