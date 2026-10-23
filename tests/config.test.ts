import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ID, DEFAULT_BACKEND_PORT, DEFAULT_VITE_DEV_PORT, ENV_PREFIX, parsePort, vitePort } from '../shared/config.js';
import pkg from '../package.json' with { type: 'json' };
import { runtimeOptions } from '../backend/runtime.js';
import { browserCommand } from '../backend/platform.js';
import { validateRuntime } from '../scripts/packaging.js';

test('Identity and port derivation match company architecture', () => {
  assert.equal(pkg.name, APP_ID);
  assert.equal(ENV_PREFIX, APP_ID.toUpperCase().replaceAll('-', '_'));
  assert.equal(DEFAULT_VITE_DEV_PORT, DEFAULT_BACKEND_PORT + 1);
  assert.equal(parsePort(undefined), DEFAULT_BACKEND_PORT);
  assert.equal(vitePort(undefined), DEFAULT_VITE_DEV_PORT);
  assert.equal(vitePort(String(DEFAULT_BACKEND_PORT)), DEFAULT_VITE_DEV_PORT);
});
test('PORT rejects invalid input and reserves room for the dev port', () => {
  for (const invalid of ['', '0', '-1', '65535', '1.1', 'hello', ' 1234', '1e3']) assert.throws(() => parsePort(invalid));
});
test('Runtime defaults and generic headless options', () => {
  const defaults = runtimeOptions({}, []);
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.noOpen, false);
  const options = runtimeOptions({ HOST: '0.0.0.0', [`${ENV_PREFIX}_NO_OPEN`]: '1' }, ['--worker-state-dir', './state']);
  assert.equal(options.noOpen, true);
  assert.equal(options.workerStateDir, './state');
  assert.equal(options.host, '0.0.0.0');
});
test('Runtime validates arguments and refuses foreign browser destinations', () => {
  assert.throws(() => runtimeOptions({}, ['--worker-state-dir']));
  assert.throws(() => runtimeOptions({}, ['--unknown']));
  assert.throws(() => runtimeOptions({ HOST: 'example.org' }, []));
  assert.throws(() => runtimeOptions({ [`${ENV_PREFIX}_OPEN_URL`]: 'http://example.org' }, []));
  assert.throws(() => browserCommand('javascript:alert(1)'));
  assert.throws(() => browserCommand('https://example.org'));
});
test('OS integration uses argument arrays, and packaging rejects unsupported targets/runtimes', () => {
  const url = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
  assert.equal(browserCommand(url, 'darwin')[0], 'open');
  assert.equal(browserCommand(url, 'win32')[0], 'rundll32');
  validateRuntime('22.12.0', 'linux');
  validateRuntime('24.14.0', 'linux');
  assert.throws(() => validateRuntime('22.11.0', 'linux'));
  assert.throws(() => validateRuntime('20.0.0', 'linux'));
  assert.throws(() => validateRuntime('24.0.0', 'win32'));
});
