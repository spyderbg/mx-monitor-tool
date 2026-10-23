import { APP_ID, DEFAULT_BACKEND_PORT, ENV_PREFIX } from '../shared/config.js';
import { run } from './packaging.js';

// No host ports, host mounts or privileged/PID-namespace options are used.
const script = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.notEqual(process.getuid(), 0);
assert.deepEqual(fs.readdirSync('/app'), ['server.cjs']);
require('./server.cjs');
setTimeout(async () => {
  try {
    const origin = 'http://127.0.0.1:' + process.env.PORT;
    assert.equal((await fetch(origin + '/api/health')).status, 200);
    assert.equal((await fetch(origin)).status, 200);
    const bootstrap = await fetch(origin + '/api/session');
    const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
    const controller = new AbortController();
    const stream = await fetch(origin + '/api/lifecycle', { headers: {cookie}, signal: controller.signal });
    await stream.body.getReader().read(); controller.abort();
    const monitorController = new AbortController();
    const monitoring = await fetch(origin + '/api/stream', { headers: {cookie}, signal: monitorController.signal });
    assert.equal(monitoring.status, 200);
    const reader = monitoring.body.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /event: snapshot/); monitorController.abort();
    setTimeout(async () => {
      try { assert.equal((await fetch(origin + '/api/health')).status, 200); console.log('Docker smoke passed: non-root, bundle-only, assets, authenticated lifecycle/monitoring SSE, headless persistence.'); }
      catch(error) { console.error(error); process.exitCode = 1; }
      finally { process.kill(process.pid, 'SIGTERM'); }
    }, 2250);
  } catch(error) { console.error(error); process.exitCode = 1; process.kill(process.pid, 'SIGTERM'); }
}, 500);
`;
await run('docker', ['run', '--rm', '--network', 'none', '-e', `PORT=${DEFAULT_BACKEND_PORT}`, '-e', `${ENV_PREFIX}_NO_OPEN=1`, '--entrypoint', 'node', APP_ID, '-e', script]);
