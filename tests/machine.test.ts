import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MachineCollector, cpuPercent, parseCpu, parseMemory } from '../backend/collectors/machine.js';
import { Monitor } from '../backend/monitor.js';
import type { WorkerSummary } from '../shared/api.js';

const memory = 'MemTotal: 1000 kB\nMemAvailable: 600 kB\nMemFree: 10 kB\nSwapTotal: 400 kB\nSwapFree: 100 kB\n';
test('CPU utilization uses deltas and excludes double-counted guest counters', () => {
  const first = parseCpu('cpu  10 0 10 70 10 0 0 0 500 500\n');
  const second = parseCpu('cpu  30 0 20 120 20 0 0 10 900 900\n');
  assert.equal(first.total, 100);
  assert.equal(cpuPercent(first, second), 40);
  assert.equal(cpuPercent(undefined, first), null);
});
test('CPU warmup, reset and invalid deltas remain unknown', () => {
  assert.equal(cpuPercent({ total: 100, idle: 50 }, { total: 90, idle: 40 }), null);
  assert.equal(cpuPercent({ total: 100, idle: 50 }, { total: 100, idle: 50 }), null);
  assert.equal(cpuPercent({ total: 100, idle: 50 }, { total: 101, idle: 52 }), null);
  assert.throws(() => parseCpu('cpu 10 bad 20 30'));
  assert.throws(() => parseCpu('cpu0 10 0 10 30'));
});
test('Memory uses MemAvailable, and swap uses total minus free, in bytes', () => {
  assert.deepEqual(parseMemory(memory), {
    memory: { totalBytes: 1024000, availableBytes: 614400, usedBytes: 409600 },
    swap: { totalBytes: 409600, usedBytes: 307200 },
  });
});
test('Memory parser rejects incomplete and impossible data; zero swap is valid', () => {
  assert.throws(() => parseMemory('MemTotal: 1000 kB'));
  assert.throws(() => parseMemory(memory.replace('600', '2000')));
  assert.equal(parseMemory(memory.replace('400 kB', '0 kB').replace('100 kB', '0 kB')).swap?.usedBytes, 0);
});
test('Non-Linux collection reports unsupported without file reads', async () => {
  const collector = new MachineCollector(async () => { throw new Error('Must not read.'); }, 'darwin');
  const result = await collector.collect();
  assert.equal(result.source.status, 'unsupported');
  assert.equal(result.memory, null);
});
test('Read failures are contained and paths are sanitized', async () => {
  const collector = new MachineCollector(async () => { throw new Error('/private/credential token=SECRET'); }, 'linux');
  const result = await collector.collect();
  assert.equal(result.source.status, 'error');
  assert.equal(result.cpuPercent, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|credential/);
});
test('Collector keeps last success time after malformed data and resets CPU baseline', async () => {
  let malformed = false;
  const collector = new MachineCollector(async name => {
    if (malformed) return 'invalid';
    return { stat: 'cpu 10 0 10 80 0 0 0 0', meminfo: memory, loadavg: '1 2 3 1/20 100', uptime: '100 50' }[name];
  }, 'linux');
  const first = await collector.collect();
  assert.equal(first.source.status, 'ok');
  malformed = true;
  const failed = await collector.collect();
  assert.equal(failed.source.lastSuccessfulAt, first.source.observedAt);
  assert.equal(failed.source.observedAt, null);
  malformed = false;
  assert.equal((await collector.collect()).cpuPercent, null);
});
test('Snapshot reads coalesce concurrent requests and use an on-demand cadence without timers', async () => {
  let reads = 0;
  const machine = new MachineCollector(async () => { reads++; throw new Error('Unavailable'); }, 'linux');
  const worker: WorkerSummary = { status: 'not_configured', source: { status: 'unavailable', observedAt: null, lastSuccessfulAt: null, detail: null } };
  const monitor = new Monitor(worker, machine);
  const [first, second] = await Promise.all([monitor.getSnapshot(), monitor.getSnapshot()]);
  assert.strictEqual(first, second);
  assert.strictEqual(first, await monitor.getSnapshot());
  assert.equal(reads, 4);
  assert.equal(first.revision, 1);
});
