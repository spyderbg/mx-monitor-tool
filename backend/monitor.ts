import type { MonitorSnapshot, WorkerSummary, MonitorDiagnostics } from '../shared/api.js';
import { MACHINE_SAMPLE_MS, MAX_TASKS, MAX_EVENTS, MAX_PROCESSES, MAX_STREAM_SUBSCRIBERS, MAX_STREAM_PENDING_BYTES, WORKER_STALE_MS } from '../shared/config.js';
import { MachineCollector } from './collectors/machine.js';
import { ProcessCollector } from './collectors/processes.js';
import type { WorkerStateAdapter, WorkerObservation } from './collectors/worker-state.js';
import { emptySection, source } from './observation.js';
import { summarizeWorker } from './worker/summary.js';

export interface MonitorOptions { sampleMs?: number; staleMs?: number; clock?: () => number; processes?: ProcessCollector }

export class Monitor {
  private snapshot: MonitorSnapshot | undefined;
  private pending: Promise<MonitorSnapshot> | undefined;
  private revision = 0;
  private collectedAt = 0;
  readonly sampleMs: number;
  private readonly clock: () => number;
  private readonly processes: ProcessCollector;
  private subscribers = 0;
  private closed = false;
  private cycleMs = 0;

  constructor(private readonly worker: WorkerSummary | WorkerStateAdapter, private readonly machine = new MachineCollector(), private readonly options: MonitorOptions = {}) {
    this.sampleMs = options.sampleMs ?? MACHINE_SAMPLE_MS;
    this.clock = options.clock ?? Date.now;
    this.processes = options.processes ?? new ProcessCollector();
  }

  setSubscribers(count: number): void { this.subscribers = count; if (this.snapshot) this.snapshot.diagnostics = this.diagnostics(); }
  diagnostics(): MonitorDiagnostics {
    return { streamSubscribers: this.subscribers, collectorRunning: this.subscribers > 0 && !this.closed, cycleMs: this.cycleMs,
      limits: { subscribers: MAX_STREAM_SUBSCRIBERS, pendingBytes: MAX_STREAM_PENDING_BYTES, tasks: MAX_TASKS, processes: MAX_PROCESSES, events: MAX_EVENTS } };
  }

  getSnapshot(): Promise<MonitorSnapshot> {
    if (this.pending) return this.pending;
    if (this.snapshot && (this.closed || this.clock() - this.collectedAt < this.sampleMs)) return Promise.resolve(this.snapshot);
    this.pending = this.collect().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async close(): Promise<void> { this.closed = true; await this.pending; }

  private async collect(): Promise<MonitorSnapshot> {
    const started = performance.now(), now = this.clock();
    const empty = (worker: WorkerSummary): WorkerObservation => ({ worker, service: null, evidence: [], claims: [],
      features: emptySection('No feature data.'), tasks: emptySection('No task data.'), events: emptySection('No event data.') });
    const readWorker = async (): Promise<WorkerObservation> => {
      if (!('read' in this.worker)) return empty(this.worker);
      try { return await this.worker.read(now); }
      catch { return empty({ status: 'unavailable', source: { status: 'error', observedAt: null, lastSuccessfulAt: null, detail: 'Worker collection failed safely.' } }); }
    };
    const collectMachine = this.machine.collect().catch(() => ({
      hostname: this.snapshot?.machine.hostname ?? 'Unknown', os: this.snapshot?.machine.os ?? process.platform,
      logicalCpus: this.snapshot?.machine.logicalCpus ?? null, cpuPercent: null, loadAverage: null, uptimeSeconds: null, memory: null, swap: null,
      source: source('error', null, 'Machine collection failed safely.', now, false, this.snapshot?.machine.source.lastSuccessfulAt ?? null),
    }));
    const [machine, observation] = await Promise.all([collectMachine, readWorker()]);
    machine.source = { ...machine.source, ageSeconds: machine.source.observedAt ? Math.max(0, (now - Date.parse(machine.source.observedAt)) / 1000) : null };
    const processes = observation.evidence.length ? await this.processes.collect(observation.evidence, now).catch(() => ({
      ...emptySection<import('../shared/api.js').ObservedProcess>('Process collection failed safely.'), source: source('error', null, 'Process collection failed safely.', now),
    })) : emptySection<import('../shared/api.js').ObservedProcess>('No recorded process identities are available.');
    const worker = summarizeWorker(observation, processes, now, this.options.staleMs ?? WORKER_STALE_MS);
    this.cycleMs = performance.now() - started;
    this.snapshot = { schemaVersion: 1, revision: ++this.revision, observedAt: new Date(now).toISOString(), machine, worker,
      features: observation.features, tasks: observation.tasks, processes, events: observation.events, diagnostics: this.diagnostics() };
    this.collectedAt = this.clock();
    return this.snapshot;
  }
}
