import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DataSection, FeatureSummary, MonitorEvent, SourceStatus, TaskSummary, WorkerSummary } from '../../shared/api.js';
import { MAX_TASKS, TASK_SAMPLE_MS } from '../../shared/config.js';
import { emptySection, source } from '../observation.js';
import type { ProcessEvidence } from './processes.js';
import { WorkerFiles, ReadFailure } from '../worker/files.js';
import { EventTailer } from '../worker/events.js';
import { InvalidRecord } from '../worker/validation.js';
import { parseCheckpoints, parseClaim, parseFeature, parseScheduling, parseService, parseTask, WORKER_FORMAT, type ParsedClaim, type ParsedService } from '../worker/parsers.js';

export interface WorkerObservation {
  worker: WorkerSummary; service: ParsedService | null; evidence: ProcessEvidence[]; claims: ParsedClaim[];
  features: DataSection<FeatureSummary>; tasks: DataSection<TaskSummary>; events: DataSection<MonitorEvent>;
}
export interface WorkerStateAdapter { readonly format: string; read(now?: number): Promise<WorkerObservation> }

function problem(error: unknown, previous: SourceStatus | undefined, now: number): SourceStatus {
  const unsupported = error instanceof InvalidRecord && error.unsupported;
  const absent = error instanceof ReadFailure && error.kind === 'missing';
  return source(previous?.lastSuccessfulAt ? 'stale' : unsupported ? 'unsupported' : absent ? 'unavailable' : 'error', previous?.observedAt ?? null,
    unsupported ? 'Unsupported Worker record format.' : absent ? 'Worker source is absent.' : 'Worker source could not be safely read or validated.', now, false, previous?.lastSuccessfulAt ?? null);
}

/** Verified against the local W4/W4.1/W4.2 persistence code, never imported/executed. */
export class W4WorkerStateAdapter implements WorkerStateAdapter {
  readonly format = WORKER_FORMAT;
  private readonly root: string;
  private readonly explicit: boolean;
  private rootIdentity = '';
  private tasks: DataSection<TaskSummary> = emptySection('Task state has not been read.');
  private features: DataSection<FeatureSummary> = emptySection('Feature state has not been read.');
  private readTasksAt = -Infinity;
  private events = new EventTailer();
  private serviceSource: SourceStatus | undefined;
  constructor(root?: string, private readonly taskSampleMs = TASK_SAMPLE_MS, private readonly hostPlatform = process.platform) {
    this.root = root ?? join(homedir(), '.local', 'state', 'mx-admin-agents'); this.explicit = root !== undefined;
  }
  async read(now = Date.now()): Promise<WorkerObservation> {
    let files: WorkerFiles;
    try {
      if (this.hostPlatform !== 'linux') throw new ReadFailure('unreadable');
      files = await WorkerFiles.open(this.root);
    } catch (error) {
      const missing = error instanceof ReadFailure && error.kind === 'missing';
      const message = missing && !this.explicit ? 'No Worker state directory is configured or present.' : 'Configured Worker state directory is missing, inaccessible, or unsafe.';
      return { worker: { status: missing && !this.explicit ? 'not_configured' : 'unavailable', directory: missing ? this.explicit ? 'missing' : 'not_configured' : 'unreadable',
        source: source(this.hostPlatform !== 'linux' ? 'unsupported' : missing ? 'unavailable' : 'error', null, message, now), format: null, identityVerified: false },
        service: null, claims: [], evidence: [], features: { ...this.features, source: problem(error, this.features.source, now) },
        tasks: { ...this.tasks, items: this.tasks.items.map(task => ({ ...task, liveIdentityVerified: false, status: task.state === 'in-progress' ? 'unknown' : task.status, source: problem(error, task.source, now) })), source: problem(error, this.tasks.source, now) },
        events: this.events.unavailable(now, message) };
    }
    try {
      if (files.identity !== this.rootIdentity) {
        this.rootIdentity = files.identity; this.readTasksAt = -Infinity; this.events.reset(); this.serviceSource = undefined;
        this.tasks = emptySection('Task state has not been read.'); this.features = emptySection('Feature state has not been read.');
      }
      let service: ParsedService | null = null;
      let serviceProblem: SourceStatus | undefined;
      try {
        service = parseService(await files.json('service', 'worker'));
        this.serviceSource = source('ok', service.heartbeatAt, null, now, false, new Date(now).toISOString());
      } catch (error) { serviceProblem = problem(error, this.serviceSource, now); }
      if (now - this.readTasksAt >= this.taskSampleMs) {
        await this.readTasks(files, now);
        this.readTasksAt = now;
      }
      const evidence: ProcessEvidence[] = [], claims: ParsedClaim[] = [];
      if (service?.identity) evidence.push({ identity: service.identity, attribution: 'worker', taskId: null });
      const tasks: TaskSummary[] = this.tasks.items.map(task => ({ ...task, source: { ...task.source, ageSeconds: task.source.observedAt ? Math.max(0, (now - Date.parse(task.source.observedAt)) / 1000) : null } }));
      for (const task of tasks) {
        try {
          const claim = parseClaim(await files.json('claims', task.id), task.id, task.featureId, task.role);
          claims.push(claim);
          if (claim.identity) evidence.push({ identity: claim.identity, attribution: 'launch', taskId: task.id });
          if (claim.agent) evidence.push({ identity: claim.agent, attribution: 'agent', taskId: task.id });
          task.activeStep = claim.step;
        } catch (error) {
          if (!(error instanceof ReadFailure && error.kind === 'missing')) {
            task.source = problem(error, task.source, now);
            if (task.state === 'in-progress') task.status = 'unknown';
          }
        }
      }
      const worker: WorkerSummary = { status: service ? 'UNKNOWN' : serviceProblem?.status === 'unavailable' ? 'unavailable' : 'UNKNOWN', directory: 'available',
        source: serviceProblem ?? this.serviceSource!, format: service || tasks.length ? this.format : null,
        identityVerified: false, persistedState: service?.state ?? null, heartbeatAt: service?.heartbeatAt ?? null,
        startedAt: service?.startedAt ?? null, reason: service?.reason ?? serviceProblem?.detail ?? null, current: null,
        lastCheckpoint: service?.lastCheckpoint ?? null };
      return { worker, service, claims, evidence, features: this.features, tasks: { ...this.tasks, items: tasks }, events: await this.events.collect(files, now) };
    } finally { await files.close(); }
  }

  private async readTasks(files: WorkerFiles, now: number): Promise<void> {
    const readAt = new Date(now).toISOString();
    try {
      const names = await files.names('features', 64), items: FeatureSummary[] = [];
      let errors = 0;
      for (const name of names.ids) {
        try { items.push(parseFeature(await files.json('features', name), name)); }
        catch { errors++; }
      }
      this.features = { items, source: source(errors || names.truncated ? 'stale' : 'ok', null, errors ? `${errors} feature records omitted because they could not be validated.` : names.truncated ? 'Feature scan capped.' : null, now, false, readAt), truncated: names.truncated };
    } catch (error) { this.features = { ...this.features, source: problem(error, this.features.source, now) }; }
    try {
      const names = await files.names('tasks', MAX_TASKS), items: TaskSummary[] = [];
      let errors = 0;
      let historyBudget = 400;
      for (const name of names.ids) {
        let task: TaskSummary;
        try { task = parseTask(await files.json('tasks', name), name, now); task.source.lastSuccessfulAt = readAt; }
        catch (error) {
          errors++;
          const old = this.tasks.items.find(task => task.id === name);
          if (old) items.push({ ...old, status: old.state === 'in-progress' ? 'unknown' : old.status, source: problem(error, old.source, now) });
          continue;
        }
        try {
          const checkpoints = parseCheckpoints(await files.json('checkpoints', name), name, task.featureId, task.role);
          if (checkpoints.steps.join('\0') !== task.steps.join('\0')) throw new InvalidRecord();
          task.checkpoints = checkpoints.checkpoints.slice(0, Math.min(20, historyBudget)); historyBudget -= task.checkpoints.length;
          task.completedSteps = checkpoints.completedSteps;
          task.checkpointSource = source('ok', checkpoints.checkpoints[0]?.at ?? null, null, now, false, readAt);
          const latest = checkpoints.checkpoints.find(checkpoint => ['committed', 'no-changes'].includes(checkpoint.status));
          task.provider = latest?.provider ?? null; task.requestedModel = latest?.requestedModel ?? null;
        } catch (error) { task.checkpointSource = problem(error, undefined, now); }
        try {
          const scheduling = parseScheduling(await files.json('scheduling', name), name, task.featureId);
          task.launches = scheduling.launches; task.failureAttempts = scheduling.failureAttempts; task.nextAttemptAt = scheduling.nextAttemptAt;
          task.schedulingSource = source('ok', null, null, now, false, readAt);
          if (task.state !== 'verified') {
            if (scheduling.attention) { task.status = 'needs-attention'; task.reason = scheduling.attention; }
            else if (scheduling.nextAttemptAt && Date.parse(scheduling.nextAttemptAt) > now) {
              task.status = scheduling.category === 'subscription' ? 'waiting-subscription' : 'waiting-retry'; task.reason = scheduling.waiting;
            }
          }
        } catch (error) { task.schedulingSource = problem(error, undefined, now); }
        items.push(task);
      }
      const states = new Map(items.map(task => [task.id, task.state]));
      for (const task of items) task.waitingOn = task.dependsOn.filter(dependency => states.get(dependency) !== 'verified');
      this.tasks = { items, source: source(errors || names.truncated ? 'stale' : 'ok', null, errors ? `${errors} task records could not be validated; last known rows are marked stale when available.` : names.truncated ? 'Task scan capped.' : null, now, false, readAt), truncated: names.truncated };
    } catch (error) { this.tasks = { ...this.tasks, source: problem(error, this.tasks.source, now) }; }
  }
}
