export interface HealthResponse {
  appId: string;
  version: string;
  status: 'ok';
  dev: boolean;
}

export interface SessionResponse { authenticated: true }
export interface ApiError { error: string }
export type SourceState = 'ok' | 'stale' | 'unavailable' | 'unsupported' | 'error';
export interface SourceStatus {
  status: SourceState;
  observedAt: string | null;
  lastSuccessfulAt: string | null;
  detail: string | null;
  ageSeconds?: number | null;
  liveIdentityVerified?: boolean;
}

export interface MachineMetrics {
  source: SourceStatus;
  hostname: string;
  os: string;
  cpuPercent: number | null;
  logicalCpus: number | null;
  loadAverage: [number, number, number] | null;
  uptimeSeconds: number | null;
  memory: { totalBytes: number; availableBytes: number; usedBytes: number } | null;
  swap: { totalBytes: number; usedBytes: number } | null;
}

export interface WorkerSummary {
  status: 'not_configured' | 'unavailable' | 'RUNNING' | 'BUSY' | 'WAITING' | 'PAUSED' | 'RECOVERING' | 'STOPPING' | 'NEEDS_ATTENTION' | 'STALE' | 'OFFLINE' | 'UNKNOWN';
  source: SourceStatus;
  format?: string | null;
  directory?: 'not_configured' | 'missing' | 'unreadable' | 'available';
  persistedState?: string | null;
  identityVerified?: boolean;
  heartbeatAt?: string | null;
  startedAt?: string | null;
  durationSeconds?: number | null;
  reason?: string | null;
  current?: ActiveRun | null;
  lastCheckpoint?: { taskId: string; step: string; commit: string | null; at: string | null } | null;
  counts?: { active: number | null; waiting: number | null; attention: number | null; verified: number | null; total: number | null };
}

export interface ActiveRun {
  featureId: string; taskId: string; role: string; provider: string | null;
  requestedModel: string | null; step: string | null; launch: number | null; startedAt: string | null;
}
export interface DataSection<T> { source: SourceStatus; items: T[]; truncated: boolean }
export interface FeatureSummary { id: string; state: string; taskIds: string[] }
export interface CheckpointSummary {
  id: string; sequence: number; step: string; status: 'pending' | 'committed' | 'no-changes' | 'abandoned' | 'superseded';
  provider: string | null; requestedModel: string | null; commit: string | null; at: string | null;
}
export interface TaskSummary {
  id: string; featureId: string; role: string; state: string; status: string;
  dependsOn: string[]; waitingOn: string[]; source: SourceStatus;
  provider: string | null; requestedModel: string | null; activeStep: string | null;
  steps: string[]; completedSteps: string[] | null; checkpoints: CheckpointSummary[];
  checkpointSource: SourceStatus; schedulingSource: SourceStatus;
  launches: number | null; retries: number | null; failureAttempts: number | null; nextAttemptAt: string | null;
  reason: string | null; liveIdentityVerified: boolean;
}
export type ProcessAttribution = 'worker' | 'launch' | 'agent' | 'child' | 'unverified';
export interface ObservedProcess {
  id: string; pid: number; ppid: number | null; parentPid: number | null; name: string; state: string;
  cpuPercent: number | null; rssBytes: number | null; elapsedSeconds: number | null;
  attribution: ProcessAttribution; identityVerified: boolean; taskId: string | null; detail: string | null;
}
export interface MonitorEvent {
  id: string; at: string; type: string; severity: 'info' | 'warning' | 'error';
  taskId: string | null; featureId: string | null; summary: string;
}
export interface MonitorDiagnostics {
  streamSubscribers: number; collectorRunning: boolean; cycleMs: number;
  limits: { subscribers: number; pendingBytes: number; tasks: number; processes: number; events: number };
}

export interface MonitorSnapshot {
  schemaVersion: 1;
  revision: number;
  observedAt: string;
  machine: MachineMetrics;
  worker: WorkerSummary;
  features: DataSection<FeatureSummary>;
  tasks: DataSection<TaskSummary>;
  processes: DataSection<ObservedProcess>;
  events: DataSection<MonitorEvent>;
  diagnostics: MonitorDiagnostics;
}

export interface StreamEnvelope { schemaVersion: 1; sequence: number; serverId: string; at: string; snapshot: MonitorSnapshot }

export interface LifecycleEvent { connected: true }
