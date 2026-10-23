import type { ActiveRun, CheckpointSummary, FeatureSummary, TaskSummary } from '../../shared/api.js';
import type { ProcessIdentity } from '../collectors/processes.js';
import { source } from '../observation.js';
import { id, ids, integer, InvalidRecord, label, list, member, object, roles, safeText, schema, sha, stamp } from './validation.js';

export const WORKER_FORMAT = 'mx-feature-worker/w4-v1';
const TASK_FIELDS = ['schema_version','id','feature_id','role','title','acceptance','depends_on','required_gates','provides_contract','grants','state','blocked_reason','evidence','commits','issue_number','history','revision'];
const SERVICE_FIELDS = ['schema_version','id','worker_id','state','state_since','reason','identity','host','instance','started_at','heartbeat_at','current','last_error','last_checkpoint','counters','revision'];
const SCHEDULING_FIELDS = ['schema_version','task_id','feature_id','launches','attempts','next_attempt_at','waiting','attention','in_flight','history','revision'];
const CHECKPOINT_FIELDS = ['id','sequence','step','status','attempt','agent','model','role','base','commit','files','completed_steps','remaining_steps','verification','summary','note','created_at','committed_at','local'];
export interface ParsedService {
  state: string; heartbeatAt: string | null; startedAt: string | null; reason: string | null;
  identity: ProcessIdentity | null; current: ActiveRun | null;
  lastCheckpoint: { taskId: string; step: string; commit: string | null; at: string | null } | null;
}
export interface ParsedClaim { taskId: string; featureId: string; identity: ProcessIdentity | null; agent: ProcessIdentity | null; step: string | null; heartbeatAt: string | null }
export interface ParsedScheduling { launches: number; failureAttempts: number; nextAttemptAt: string | null; attention: string | null; waiting: string | null; category: string | null }
export function identity(value: unknown): ProcessIdentity | null {
  if (value === null || value === undefined) return null;
  try {
    const record = object(value);
    const bootId = record.boot_id;
    if (typeof bootId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(bootId)) return null;
    return { pid: integer(record.pid, 1), startTicks: integer(record.start_ticks), bootId };
  } catch { return null; }
}
export function parseService(value: unknown): ParsedService {
  const record = schema(value, [1], SERVICE_FIELDS);
  if (record.id !== 'worker' || typeof record.worker_id !== 'string') throw new InvalidRecord();
  integer(record.revision);
  const state = member(record.state, ['AVAILABLE','BUSY','WAITING','PAUSED','RECOVERING','NEEDS_ATTENTION','STOPPING','OFFLINE','UNRESPONSIVE']);
  let current: ActiveRun | null = null;
  if (record.current !== null && record.current !== undefined) {
    const run = object(record.current);
    current = { featureId: id(run.feature), taskId: id(run.task), role: member(run.role, roles), provider: label(run.agent),
      requestedModel: label(run.model), step: run.step == null ? null : id(run.step), launch: run.launch == null ? null : integer(run.launch), startedAt: stamp(run.started_at) };
  }
  let lastCheckpoint: ParsedService['lastCheckpoint'] = null;
  if (record.last_checkpoint != null) {
    const checkpoint = object(record.last_checkpoint);
    lastCheckpoint = { taskId: id(checkpoint.task), step: id(checkpoint.step), commit: sha(checkpoint.commit), at: stamp(checkpoint.at) };
  }
  const error = record.last_error == null ? null : object(record.last_error);
  return { state, heartbeatAt: stamp(record.heartbeat_at), startedAt: stamp(record.started_at), identity: identity(record.identity), current,
    reason: safeText(error?.reason) ?? safeText(record.reason), lastCheckpoint };
}
export function parseFeature(value: unknown, expectedId: string): FeatureSummary {
  const record = schema(value, [1]);
  if (id(record.id) !== expectedId) throw new InvalidRecord();
  return { id: expectedId, state: member(record.state, ['planned','active','integration','review','done','blocked','failed']), taskIds: ids(record.task_ids) };
}
export function parseTask(value: unknown, expectedId: string, now: number): TaskSummary {
  const raw = object(value);
  const record = schema(value, [1, 2], raw.schema_version === 2 ? [...TASK_FIELDS, 'steps'] : TASK_FIELDS);
  if (id(record.id) !== expectedId) throw new InvalidRecord();
  integer(record.revision);
  const state = member(record.state, ['proposed','ready','in-progress','verified','blocked','failed','needs-human']);
  const history = record.history === undefined ? [] : list(record.history);
  const last = history.length ? object(history.at(-1)) : null;
  const steps = record.schema_version === 2 ? list(record.steps ?? [], 20).map(value => id(object(value).key)) : [];
  if (new Set(steps).size !== steps.length) throw new InvalidRecord();
  return { id: expectedId, featureId: id(record.feature_id), role: member(record.role, roles), state, status: state,
    dependsOn: ids(record.depends_on ?? []), waitingOn: [], steps, completedSteps: null, checkpoints: [],
    source: source('ok', stamp(last?.at), null, now), checkpointSource: source('unavailable', null, 'No checkpoint record.'),
    schedulingSource: source('unavailable', null, 'No scheduling record.'), provider: null, requestedModel: null, activeStep: null,
    launches: null, retries: null, failureAttempts: null, nextAttemptAt: null, reason: safeText(record.blocked_reason), liveIdentityVerified: false };
}
export function parseClaim(value: unknown, taskId: string, featureId: string, role: string): ParsedClaim {
  const record = object(value);
  if (Object.keys(record).some(key => !['task_id','feature_id','role','token','identity','branch','head_sha','acquired_at','heartbeat_at','checkpoint'].includes(key))) throw new InvalidRecord(true);
  if (id(record.task_id) !== taskId || id(record.feature_id) !== featureId) throw new InvalidRecord();
  if (member(record.role, roles) !== role) throw new InvalidRecord();
  const progress = record.checkpoint == null ? {} : object(record.checkpoint);
  return { taskId, featureId, identity: identity(record.identity), agent: identity(progress.agent),
    step: progress.step == null ? null : id(progress.step), heartbeatAt: stamp(record.heartbeat_at) };
}
export function parseScheduling(value: unknown, taskId: string, featureId: string): ParsedScheduling {
  const record = schema(value, [1], SCHEDULING_FIELDS);
  if (id(record.task_id) !== taskId || id(record.feature_id) !== featureId) throw new InvalidRecord();
  integer(record.revision);
  const attempts = object(record.attempts);
  const failureAttempts = Object.values(attempts).reduce<number>((sum, value) => sum + integer(value), 0);
  if (!Number.isSafeInteger(failureAttempts)) throw new InvalidRecord();
  const attention = record.attention == null ? null : object(record.attention), waiting = record.waiting == null ? null : object(record.waiting);
  const next = record.next_attempt_at;
  if (next !== null && next !== undefined && (typeof next !== 'number' || !Number.isFinite(next) || next < 0 || next > 8.64e12)) throw new InvalidRecord();
  return { launches: integer(record.launches), failureAttempts, nextAttemptAt: typeof next === 'number' ? new Date(next * 1000).toISOString() : null,
    attention: attention ? safeText(attention.reason) ?? 'Operator attention required.' : null,
    waiting: waiting ? safeText(waiting.reason) ?? 'Waiting for next attempt.' : null, category: label(waiting?.category) };
}
export function parseCheckpoints(value: unknown, taskId: string, featureId: string, role: string): { checkpoints: CheckpointSummary[]; completedSteps: string[]; steps: string[] } {
  const record = schema(value, [1], ['schema_version','task_id','feature_id','role','steps','checkpoints','verifications','revision']);
  if (id(record.task_id) !== taskId || id(record.feature_id) !== featureId || record.role !== role) throw new InvalidRecord();
  integer(record.revision);
  const steps = ids(record.steps, 20);
  const checkpoints = list(record.checkpoints, 256).map(value => {
    const checkpoint = object(value);
    if (Object.keys(checkpoint).some(key => !CHECKPOINT_FIELDS.includes(key))) throw new InvalidRecord(true);
    if (checkpoint.role !== role) throw new InvalidRecord();
    if (typeof checkpoint.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(checkpoint.id) || !steps.includes(id(checkpoint.step))) throw new InvalidRecord();
    const status = member(checkpoint.status, ['pending','committed','no-changes','abandoned','superseded'] as const);
    if (status === 'committed' && !sha(checkpoint.commit)) throw new InvalidRecord();
    return { id: checkpoint.id, sequence: integer(checkpoint.sequence, 1), step: id(checkpoint.step),
      status,
      provider: label(checkpoint.agent), requestedModel: label(checkpoint.model), commit: sha(checkpoint.commit), at: stamp(checkpoint.committed_at) ?? stamp(checkpoint.created_at) };
  });
  if (new Set(checkpoints.map(checkpoint => checkpoint.id)).size !== checkpoints.length || new Set(checkpoints.map(checkpoint => checkpoint.sequence)).size !== checkpoints.length) throw new InvalidRecord();
  const done = new Set(checkpoints.filter(checkpoint => ['committed','no-changes'].includes(checkpoint.status)).map(checkpoint => checkpoint.step));
  return { checkpoints: checkpoints.sort((a, b) => b.sequence - a.sequence).slice(0, 50), completedSteps: steps.filter(step => done.has(step)), steps };
}
