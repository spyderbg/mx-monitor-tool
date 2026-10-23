import { spawn, type ChildProcess } from 'node:child_process';
import { ENV_PREFIX, DEFAULT_BACKEND_PORT, DEFAULT_VITE_DEV_PORT, parsePort } from '../shared/config.js';

const port = process.env.PORT === undefined ? DEFAULT_BACKEND_PORT : parsePort(process.env.PORT);
const devPort = process.env.PORT === undefined ? DEFAULT_VITE_DEV_PORT : port + 1;
const children = new Set<ChildProcess>();
let closing = false;
const close = (code = 0): void => {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
};
process.once('SIGINT', () => close());
process.once('SIGTERM', () => close());

function start(script: string, env: NodeJS.ProcessEnv, ipc = false): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    stdio: ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit', env,
  });
  children.add(child);
  child.once('error', () => close(1));
  child.once('exit', code => {
    children.delete(child);
    if (!closing) close(code ?? 1);
  });
  return child;
}

// Vite installs its own process-exit handlers. Isolate it so it cannot terminate
// the supervisor before the owned backend has finished shutting down.
const vite = start('scripts/vite-dev.ts', process.env, true);
await new Promise<void>(done => {
  vite.once('message', () => done());
  vite.once('exit', () => done());
  vite.once('error', () => done());
});
if (!closing) start('backend/main.ts', {
  ...process.env, [`${ENV_PREFIX}_DEV`]: '1', [`${ENV_PREFIX}_OPEN_URL`]: `http://127.0.0.1:${devPort}`,
});
