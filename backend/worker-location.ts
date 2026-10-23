import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WorkerSummary } from '../shared/api.js';

export async function workerAvailability(configuredPath?: string, conventionalPath = join(homedir(), '.local', 'state', 'mx-admin-agents')): Promise<WorkerSummary> {
  const path = configuredPath ?? conventionalPath;
  try {
    if (!(await stat(path)).isDirectory()) throw new Error('Not a directory.');
    return {
      status: 'unavailable',
      source: { status: 'unsupported', observedAt: null, lastSuccessfulAt: null,
        detail: 'State directory found. Record health and live identity are resolved by the Worker adapter.' },
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      status: missing && !configuredPath ? 'not_configured' : 'unavailable',
      source: { status: 'unavailable', observedAt: null, lastSuccessfulAt: null,
        detail: missing && !configuredPath ? 'No Worker state directory is configured or present.' :
          'Configured Worker state directory is missing, inaccessible, or not a directory.' },
    };
  }
}
