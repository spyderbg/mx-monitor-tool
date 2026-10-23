import type { DataSection, ObservedProcess, WorkerSummary } from '../../shared/api.js';
import { WORKER_STALE_MS } from '../../shared/config.js';
import type { WorkerObservation } from '../collectors/worker-state.js';
import { source } from '../observation.js';
import type { ProcessIdentity } from '../collectors/processes.js';

export function summarizeWorker(observation: WorkerObservation, processes: DataSection<ObservedProcess>, now: number, staleMs = WORKER_STALE_MS): WorkerSummary {
  const { worker, service } = observation;
  const key = (identity: ProcessIdentity): string => `${identity.bootId}:${identity.pid}:${identity.startTicks}`;
  const live = (identity: ProcessIdentity | null | undefined): boolean => !!identity && processes.items.some(process => process.id === key(identity) && process.identityVerified);
  const gone = (identity: ProcessIdentity | null | undefined): boolean => {
    if (!identity) return false;
    const process = processes.items.find(process => process.pid === identity.pid);
    return process?.state === 'gone' || (!!process && process.ppid !== null && (process.id !== key(identity) || ['Z','X','x'].includes(process.state)));
  };
  for (const task of observation.tasks.items) {
    task.liveIdentityVerified = false;
    const claim = observation.claims.find(claim => claim.taskId === task.id);
    const alive = live(claim?.identity);
    if (task.state === 'in-progress') {
      task.liveIdentityVerified = alive;
      const holderGone = gone(claim?.identity);
      const orphan = !alive && holderGone && live(claim?.agent);
      const age = claim?.heartbeatAt ? now - Date.parse(claim.heartbeatAt) : null;
      task.status = task.source.status !== 'ok' ? 'unknown' : alive ? age === null || age > 120_000 || age < -5_000 ? 'slow' : 'running' : orphan ? 'orphaned' : holderGone ? 'interrupted' : 'unverified';
      if (!alive) task.activeStep = null;
      task.source = { ...task.source, liveIdentityVerified: alive };
    }
    if (service?.current?.taskId === task.id) {
      task.provider = service.current.provider; task.requestedModel = service.current.requestedModel;
    }
  }
  const complete = observation.tasks.source.status === 'ok' && !observation.tasks.truncated && observation.tasks.items.every(task => task.source.status === 'ok');
  const known = observation.tasks.items.filter(task => task.source.status === 'ok');
  const counts: NonNullable<WorkerSummary['counts']> = {
    total: complete ? known.length : null,
    active: complete && known.every(task => !['unknown', 'unverified'].includes(task.status)) ? known.filter(task => task.liveIdentityVerified).length : null,
    waiting: complete ? known.filter(task => task.status.startsWith('waiting') || task.waitingOn.length > 0 || task.state === 'blocked').length : null,
    attention: complete ? known.filter(task => ['failed', 'needs-human', 'needs-attention', 'orphaned', 'interrupted'].includes(task.status)).length : null,
    verified: complete ? known.filter(task => task.state === 'verified').length : null,
  };
  if (!service) return { ...worker, counts };
  const verified = live(service.identity);
  const absent = gone(service.identity);
  const heartbeatAge = service.heartbeatAt ? now - Date.parse(service.heartbeatAt) : null;
  const fresh = heartbeatAge !== null && heartbeatAge >= -5_000 && heartbeatAge <= staleMs;
  const status: WorkerSummary['status'] = service.state === 'OFFLINE' || absent ? 'OFFLINE' : !verified ? 'UNKNOWN' : !fresh || worker.source.status !== 'ok' || service.state === 'UNRESPONSIVE' ? 'STALE' : service.state === 'AVAILABLE' ? 'RUNNING' : service.state as WorkerSummary['status'];
  const current = verified && fresh && !['OFFLINE','UNKNOWN','STALE'].includes(status) ? service.current : null;
  const start = service.startedAt ? Date.parse(service.startedAt) : null;
  return { ...worker, status, identityVerified: verified, current, counts,
    durationSeconds: verified && fresh && status !== 'OFFLINE' && start !== null && now >= start ? (now - start) / 1000 : null,
    source: source(status === 'STALE' ? 'stale' : worker.source.status, service.heartbeatAt,
      status === 'OFFLINE' ? 'Worker is offline. Persisted state is historical, not live activity.' : !verified ? 'Worker liveness cannot be verified from its recorded identity.' : !fresh ? 'Worker identity is live, but its heartbeat is missing, stale, or in the future.' : worker.source.detail, now, verified, worker.source.lastSuccessfulAt) };
}
