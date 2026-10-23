import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from '../backend/server.js';
import { APP_ID, SESSION_COOKIE } from '../shared/config.js';
import type { MonitorSnapshot } from '../shared/api.js';
import { workerAvailability } from '../backend/worker-location.js';

const headers = { host: '127.0.0.1' };
const html = '<!doctype html><html><body>Monitor</body></html>';
const assets = { '/index.html': { mime: 'text/html', base64: Buffer.from(html).toString('base64') } };
const app = () => createServer({ assets, workerStateDir: resolve('build/definitely-missing-worker') });
async function cookie(server: Awaited<ReturnType<typeof createServer>>): Promise<string> {
  const response = await server.inject({ url: '/api/session', headers });
  return String(response.headers['set-cookie']).split(';')[0]!;
}

test('Health publicly exposes minimal app identity, and always has hardened headers', async context => {
  const server = await app(); context.after(() => server.close());
  const response = await server.inject({ url: '/api/health', headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { appId: APP_ID, version: '0.1.0', dev: false, status: 'ok' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'same-origin');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/);
});
test('Foreign Host, forged authority and cross-site requests are forbidden, including bootstrap', async context => {
  const server = await app(); context.after(() => server.close());
  for (const host of ['example.org', 'localhost.evil.test', '127.0.0.1@evil.test', '127.1', '[::1]']) {
    assert.equal((await server.inject({ url: '/', headers: { host } })).statusCode, 403);
  }
  for (const url of ['/api/session', '/api/health', '/api/snapshot', '/api/lifecycle']) {
    for (const site of ['cross-site', 'same-site']) {
      assert.equal((await server.inject({ url, headers: { ...headers, 'sec-fetch-site': site } })).statusCode, 403);
    }
    assert.equal((await server.inject({ url, headers: { ...headers, origin: 'http://evil.test' } })).statusCode, 403);
  }
});
test('Snapshot and lifecycle SSE require a valid per-start session', async context => {
  const server = await app(); const second = await app();
  context.after(async () => { await server.close(); await second.close(); });
  const session = await cookie(server);
  for (const url of ['/api/snapshot', '/api/lifecycle']) {
    for (const value of ['', `${SESSION_COOKIE}=bad`, `${SESSION_COOKIE}=${'é'.repeat(64)}`]) {
      assert.equal((await server.inject({ url, headers: { ...headers, cookie: value } })).statusCode, 401);
    }
    assert.equal((await second.inject({ url, headers: { ...headers, cookie: session } })).statusCode, 401);
  }
  const bootstrap = await server.inject({ url: '/api/session', headers });
  assert.match(String(bootstrap.headers['set-cookie']), /HttpOnly; SameSite=Strict; Path=\/api/);
  assert.equal((await server.inject({ url: '/api/snapshot', headers: { ...headers, cookie: session } })).statusCode, 200);
});
test('SPA navigation fallback excludes APIs, missing assets, traversal and non-navigation requests', async context => {
  const server = await app(); context.after(() => server.close());
  const auth = { ...headers, cookie: await cookie(server), accept: 'text/html' };
  assert.equal((await server.inject({ url: '/', headers })).body, html);
  assert.equal((await server.inject({ url: '/dashboard', headers: auth })).body, html);
  for (const url of ['/api/nope', '/api', '/missing.js', '/nested/missing.css', '/favicon.ico']) {
    assert.equal((await server.inject({ url, headers: auth })).statusCode, 404);
  }
  assert.equal((await server.inject({ url: '/dashboard', headers })).statusCode, 404);
  assert.equal((await server.inject({ url: '/%2e%2e%2fsecret', headers: auth })).statusCode, 400);
  const malformed = await server.inject({ url: '/%', headers: auth });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.headers['cache-control'], 'no-store');
  assert.equal(malformed.headers['x-content-type-options'], 'nosniff');
  assert.match(String(malformed.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(malformed.json().error, 'Invalid request.');
  assert.equal((await server.inject({ url: '/%', headers: { host: 'evil.test' } })).statusCode, 403);
});
test('Missing Worker state never blocks startup or creates a directory', async context => {
  await mkdir('build/test-fixtures', { recursive: true });
  const directory = await mkdtemp(resolve('build/test-fixtures/absent-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const server = await createServer({ workerStateDir: join(directory, 'not-present') });
  context.after(() => server.close());
  const response = await server.inject({ url: '/api/snapshot', headers: { ...headers, cookie: await cookie(server) } });
  const snapshot = response.json<MonitorSnapshot>();
  assert.equal(snapshot.worker.status, 'unavailable');
  assert.equal(snapshot.worker.source.observedAt, null);
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await workerAvailability(undefined, join(directory, 'not-present'))).status, 'not_configured');
});
test('Worker records and secrets are not read or changed by M0 snapshots', async context => {
  await mkdir('build/test-fixtures', { recursive: true });
  const directory = await mkdtemp(resolve('build/test-fixtures/worker-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const files = ['state.json', 'claims.json', 'checkpoints.json', 'events.jsonl', 'auth', 'transcript'];
  const content = 'SECRET_TOKEN_DO_NOT_READ';
  await Promise.all(files.map(file => writeFile(join(directory, file), content)));
  const server = await createServer({ workerStateDir: directory });
  context.after(() => server.close());
  const session = await cookie(server);
  for (let index = 0; index < 3; index++) {
    const response = await server.inject({ url: '/api/snapshot', headers: { ...headers, cookie: session } });
    assert.doesNotMatch(response.body, /SECRET_TOKEN|transcript|auth|worker-\w+/);
    assert.equal(response.json<MonitorSnapshot>().worker.status, 'unavailable');
  }
  for (const file of files) assert.equal(await readFile(join(directory, file), 'utf8'), content);
});
test('Real HTTP SSE authenticates, sends ready, reconnects, and closes promptly with the server', async context => {
  const server = await app();
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  context.after(() => server.close());
  const bootstrap = await fetch(`${address}/api/session`);
  const session = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const stream = await fetch(`${address}/api/lifecycle`, { headers: { cookie: session }, signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('cache-control'), 'no-store');
    assert.match(stream.headers.get('content-type')!, /text\/event-stream/);
    const reader = stream.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  const controller = new AbortController();
  const stream = await fetch(`${address}/api/lifecycle`, { headers: { cookie: session }, signal: controller.signal });
  assert.equal(stream.status, 200);
  await server.close();
  controller.abort();
});

test('Lifecycle caps subscribers and releases capacity after disconnect', { timeout: 10_000 }, async context => {
  const server = await app();
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const controllers: AbortController[] = [];
  context.after(async () => { for (const controller of controllers) controller.abort(); await server.close(); });
  const bootstrap = await fetch(`${address}/api/session`);
  const session = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  await Promise.all(Array.from({ length: 64 }, async () => {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${address}/api/lifecycle`, { headers: { cookie: session }, signal: controller.signal });
    assert.equal(response.status, 200);
  }));
  assert.equal((await fetch(`${address}/api/lifecycle`, { headers: { cookie: session } })).status, 503);
  controllers.pop()!.abort();
  await new Promise(resolve => setTimeout(resolve, 50));
  const controller = new AbortController(); controllers.push(controller);
  assert.equal((await fetch(`${address}/api/lifecycle`, { headers: { cookie: session }, signal: controller.signal })).status, 200);
});
