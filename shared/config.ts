export const APP_ID = 'mx-monitor-tool';
export const ENV_PREFIX = APP_ID.replaceAll('-', '_').toUpperCase();
// PROVISIONAL: no parent registry was supplied. Requires operator registration.
export const PORT_BLOCK = 3490;
export const DEFAULT_BACKEND_PORT = PORT_BLOCK;
export const DEFAULT_VITE_DEV_PORT = PORT_BLOCK + 1;
export const SESSION_COOKIE = `${APP_ID}-session`;
export const MACHINE_SAMPLE_MS = 1_000;
export const PAGE_CLOSE_GRACE_MS = 2_000;
export const TASK_SAMPLE_MS = 2_000;
export const WORKER_STALE_MS = 90_000; // 3 × the verified Worker's default 30-second heartbeat; configurable.
export const MAX_TASKS = 128;
export const MAX_PROCESSES = 64;
export const MAX_EVENTS = 100;
export const MAX_STREAM_SUBSCRIBERS = 32;
export const MAX_STREAM_PENDING_BYTES = 4 * 1024 * 1024;

export function parseInterval(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error('Monitoring interval is outside its supported range.');
  }
  return Number(value);
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BACKEND_PORT;
  if (!/^\d+$/.test(value)) throw new Error('PORT must be an integer between 1 and 65534.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65534) {
    throw new Error('PORT must be an integer between 1 and 65534.');
  }
  return port;
}

export function vitePort(value: string | undefined): number {
  return value === undefined ? DEFAULT_VITE_DEV_PORT : parsePort(value) + 1;
}
