import { after, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, chmod, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { APP_ID, ENV_PREFIX, PAGE_CLOSE_GRACE_MS, vitePort } from '../shared/config.js';
import type { MonitorSnapshot, StreamEnvelope } from '../shared/api.js';
import { fixture } from '../tests/fixtures/worker.js';

await mkdir('build/smoke', { recursive: true });
const root = await mkdtemp(resolve('build/smoke/run-'));
const bin = join(root, 'bin');
await mkdir(bin);
const capture = join(root, 'opened-url');
await writeFile(join(bin, 'xdg-open'), `#!/bin/sh\nprintf '%s\\n' "$@" > "$${ENV_PREFIX}_BROWSER_CAPTURE"\n`);
await chmod(join(bin, 'xdg-open'), 0o755);
const standalone = join(root, APP_ID);
await copyFile(resolve('dist', APP_ID), standalone);
await chmod(standalone, 0o755);

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

function launch(context: TestContext, executable: string, args: string[], port: number, suppressOpen = true, cwd = root) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1',
    PATH: `${bin}:${process.env.PATH ?? ''}`, [`${ENV_PREFIX}_BROWSER_CAPTURE`]: capture,
    [`${ENV_PREFIX}_NO_OPEN`]: suppressOpen ? '1' : '0', [`${ENV_PREFIX}_DEV`]: '0',
    [`${ENV_PREFIX}_WORKER_STATE_DIR`]: join(root, 'absent-worker'),
    STOP_ON_PAGE_CLOSE: 'false', [`${ENV_PREFIX}_STOP_ON_PAGE_CLOSE`]: 'false',
  };
  delete env[`${ENV_PREFIX}_OPEN_URL`];
  delete env.NODE_OPTIONS;
  const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  });
  return { child, exited, output: () => output, origin: `http://127.0.0.1:${port}` };
}

async function waitForReady(instance: ReturnType<typeof launch>): Promise<void> {
  for (let index = 0; index < 80; index++) {
    if (instance.child.exitCode !== null) throw new Error(instance.output());
    try {
      const response = await fetch(`${instance.origin}/api/health`, { signal: AbortSignal.timeout(250) });
      if (response.ok && (await response.json()).appId === APP_ID) return;
    } catch { /* Waiting for our own child to bind. */ }
    await delay(50);
  }
  throw new Error(`Monitor did not become ready: ${instance.output()}`);
}

async function session(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/session`);
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function stream(origin: string, cookie: string) {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/lifecycle`, { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  return { reader, close: async () => { controller.abort(); await reader.cancel().catch(() => {}); } };
}

async function monitoring(origin: string, cookie: string) {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/stream`, { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status,200);
  const reader = response.body!.getReader(); let buffer='';
  const next = async (): Promise<StreamEnvelope> => {
    for (;;) {
      let index;
      while ((index=buffer.indexOf('\n\n'))>=0) {
        const frame=buffer.slice(0,index); buffer=buffer.slice(index+2);
        if (frame.includes('event: snapshot\n')) return JSON.parse(frame.split('\n').find(line=>line.startsWith('data: '))!.slice(6)) as StreamEnvelope;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part=await Promise.race([reader.read(),new Promise<never>((_done,reject)=>{timer=setTimeout(()=>reject(new Error('Snapshot SSE timeout.')),5000);})]).finally(()=>clearTimeout(timer));
      if(part.done) throw new Error('Monitoring stream ended unexpectedly.');
      buffer+=new TextDecoder().decode(part.value);
    }
  };
  return {next,close:async()=>{controller.abort();await reader.cancel().catch(()=>{});}};
}

async function exitCleanly(instance: ReturnType<typeof launch>, timeout = 5_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([instance.exited, new Promise<never>((_done, reject) => {
      timer = setTimeout(() => reject(new Error(`Monitor did not exit: ${instance.output()}`)), timeout);
    })]);
    assert.equal(result.code, 0, instance.output());
    assert.equal(result.signal, null);
  } finally { clearTimeout(timer); }
}

test('Node bundle works away from source, serves real metrics/assets, and stays alive after tabs close', { timeout: 20_000 }, async context => {
  const instance = launch(context, process.execPath, [resolve('build/server.cjs'), '--no-open'], await freePort());
  await waitForReady(instance);
  await assert.rejects(readFile(capture), { code: 'ENOENT' });
  const page = await fetch(instance.origin);
  const html = await page.text();
  assert.match(html, /<div id="app">/);
  for (const path of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
    assert.equal((await fetch(`${instance.origin}${path[1]}`)).status, 200);
  }
  const cookie = await session(instance.origin);
  const snapshot = async () => {
    const response = await fetch(`${instance.origin}/api/snapshot`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return await response.json() as MonitorSnapshot;
  };
  const first = await snapshot();
  assert.equal(first.machine.source.status, 'ok');
  assert((first.machine.memory?.totalBytes ?? 0) > 0);
  await delay(1100);
  const second = await snapshot();
  assert(second.revision > first.revision);
  assert(second.machine.cpuPercent !== null && second.machine.cpuPercent >= 0 && second.machine.cpuPercent <= 100);
  const lifetime = await stream(instance.origin, cookie);
  await lifetime.close();
  await delay(PAGE_CLOSE_GRACE_MS + 250);
  assert.equal(instance.child.exitCode, null);
  instance.child.kill('SIGTERM');
  await exitCleanly(instance);
});

test('Dev starts both services and proxies authenticated same-origin API requests with PORT override', { timeout: 15_000 }, async context => {
  const port = await freePort();
  const instance = launch(context, process.execPath, ['--import', 'tsx', resolve('scripts/dev.ts')], port, true, resolve('.'));
  await waitForReady(instance);
  const frontend = `http://127.0.0.1:${vitePort(String(port))}`;
  const page = await fetch(frontend);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/src\/main.ts/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const headers = { origin: frontend, 'sec-fetch-site': 'same-origin' };
  const health = await fetch(`${frontend}/api/health`, { headers });
  assert.equal((await health.json()).dev, true);
  const bootstrap = await fetch(`${frontend}/api/session`, { headers });
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await fetch(`${frontend}/api/snapshot`, { headers: { ...headers, cookie } })).status, 200);
  assert.equal((await fetch(`${frontend}/api/session`, { headers: { origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' } })).status, 403);
  instance.child.kill('SIGTERM');
  await exitCleanly(instance);
});

test('SEA is standalone, waits for first tab, preserves multiple tabs/refresh and bakes last-tab shutdown', { timeout: 20_000 }, async context => {
  const instance = launch(context, standalone, ['--no-open'], await freePort());
  await waitForReady(instance);
  await delay(PAGE_CLOSE_GRACE_MS + 150);
  assert.equal(instance.child.exitCode, null, 'Must wait before first tab.');
  assert.equal((await fetch(instance.origin)).status, 200);
  const cookie = await session(instance.origin);
  const first = await stream(instance.origin, cookie);
  const second = await stream(instance.origin, cookie);
  await first.close();
  await delay(PAGE_CLOSE_GRACE_MS + 150);
  assert.equal(instance.child.exitCode, null, 'Another tab is still open.');
  await second.close();
  await delay(500);
  const refreshed = await stream(instance.origin, cookie);
  await delay(PAGE_CLOSE_GRACE_MS + 150);
  assert.equal(instance.child.exitCode, null, 'Refresh reconnect cancels shutdown.');
  const closedAt = performance.now();
  await refreshed.close();
  await exitCleanly(instance);
  assert(performance.now() - closedAt >= PAGE_CLOSE_GRACE_MS - 100);
});

test('Default browser launch receives local URL, and an existing same-app instance is forwarded', { timeout: 10_000 }, async context => {
  const port = await freePort();
  const first = launch(context, standalone, [], port, false);
  await waitForReady(first);
  for (let index = 0; index < 40; index++) {
    try { if ((await readFile(capture, 'utf8')).trim() === first.origin) break; } catch { /* Stub has not run. */ }
    await delay(25);
  }
  assert.equal((await readFile(capture, 'utf8')).trim(), first.origin);
  const second = launch(context, standalone, ['--no-open'], port);
  await exitCleanly(second);
  assert.match(second.output(), /Existing Monitor instance/);
  assert.equal(first.child.exitCode, null);
  first.child.kill('SIGINT');
  await exitCleanly(first);
});

test('Unrelated port collision is reported and the unrelated service remains untouched', { timeout: 10_000 }, async context => {
  const other = createHttpServer((_request, response) => response.end('{"appId":"another-app"}'));
  await new Promise<void>(done => other.listen(0, '127.0.0.1', done));
  context.after(() => new Promise<void>((done, reject) => other.close(error => error ? reject(error) : done())));
  const address = other.address(); assert(address && typeof address !== 'string');
  const instance = launch(context, standalone, ['--no-open'], address.port);
  const result = await instance.exited;
  assert.equal(result.code, 1);
  assert.match(instance.output(), /Port in use by another application/);
  assert.equal((await fetch(instance.origin)).status, 200);
});

test('Lifecycle delivers heartbeat and frees the connection on disconnect', { timeout: 25_000 }, async context => {
  const instance = launch(context, standalone, ['--no-open'], await freePort());
  await waitForReady(instance);
  const cookie = await session(instance.origin);
  const lifetime = await stream(instance.origin, cookie);
  assert.match(new TextDecoder().decode((await lifetime.reader.read()).value), /heartbeat/);
  await lifetime.close();
  await exitCleanly(instance);
});

test('SEA monitoring SSE advances real machine samples and independently parses a stopped schema-matched Worker', { timeout:15_000 },async context=>{
  const stateRoot=await fixture(); context.after(()=>rm(stateRoot,{recursive:true,force:true}));
  const instance=launch(context,standalone,['--no-open','--worker-state-dir',stateRoot],await freePort());
  await waitForReady(instance);
  for(const path of ['/%61pi/snapshot','/%61pi/lifecycle','/%61pi/stream']) assert.equal((await fetch(`${instance.origin}${path}`)).status,401);
  const cookie=await session(instance.origin);
  const lifetime=await stream(instance.origin,cookie), updates=await monitoring(instance.origin,cookie);
  context.after(()=>updates.close()); context.after(()=>lifetime.close());
  const first=await updates.next(), second=await updates.next(), third=await updates.next();
  assert(second.sequence>first.sequence && third.sequence>second.sequence);
  assert(third.snapshot.revision>first.snapshot.revision); assert(third.snapshot.machine.cpuPercent!==null);
  assert.equal(third.snapshot.worker.status,'OFFLINE'); assert.equal(third.snapshot.worker.persistedState,'BUSY'); assert.equal(third.snapshot.worker.current,null);
  assert.equal(third.snapshot.tasks.items[0]?.checkpoints[0]?.commit,'aaaaaaaaaaaa'); assert(third.snapshot.events.items.length>0);
  assert.doesNotMatch(JSON.stringify(third),/PRIVATE|SECRET|run_dir/);
  await updates.close(); await lifetime.close(); await exitCleanly(instance);
});

test('Measure idle and active bundle CPU/RSS without touching other processes', { timeout: 15_000 }, async context => {
  const instance = launch(context, process.execPath, [resolve('build/server.cjs'), '--no-open'], await freePort());
  await waitForReady(instance);
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  const pageSize = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim());
  const observation = async () => {
    const text = await readFile(`/proc/${instance.child.pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { ticks: Number(fields[11]) + Number(fields[12]), rss: Number(fields[21]) * pageSize };
  };
  async function measure(active: boolean) {
    const cookie = active ? await session(instance.origin) : '';
    const lifetime = active ? await stream(instance.origin, cookie) : undefined;
    const updates = active ? await monitoring(instance.origin,cookie) : undefined;
    const initial = updates ? await updates.next() : undefined;
    if(initial) assert.equal(initial.snapshot.diagnostics.streamSubscribers,1);
    const start = await observation();
    const startTime = performance.now();
    let peakRss = start.rss;
    for (let index = 0; index < 3; index++) {
      if (active) assert.equal((await fetch(`${instance.origin}/api/snapshot`, { headers: { cookie } })).status, 200);
      await delay(1000);
      peakRss = Math.max(peakRss, (await observation()).rss);
    }
    const end = await observation();
    const seconds = (performance.now() - startTime) / 1000;
    await lifetime?.close();
    await updates?.close();
    return { seconds, cpuPercentOfOneCore: (end.ticks - start.ticks) / ticksPerSecond / seconds * 100, rssMiB: end.rss / 1024 ** 2, peakRssMiB: peakRss / 1024 ** 2,
      streamSubscribers:initial?.snapshot.diagnostics.streamSubscribers??0,pendingBytesLimit:initial?.snapshot.diagnostics.limits.pendingBytes??null };
  }
  const idle = await measure(false);
  const active = await measure(true);
  const report = { node: process.version, measuredAt: new Date().toISOString(), cadence: 'one monitoring SSE, one lifecycle SSE and one snapshot HTTP request per second', idle, active };
  await writeFile(resolve(`build/resources-m1-node${process.versions.node.split('.')[0]}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  instance.child.kill('SIGTERM');
  await exitCleanly(instance);
});

// Temporary artifacts are confined to build/ and retained only until this test run ends.
after(async () => { await rm(root, { recursive: true, force: true }); });
