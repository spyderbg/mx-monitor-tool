import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageLifetime } from '../backend/page-lifetime.js';
import { PAGE_CLOSE_GRACE_MS } from '../shared/config.js';

test('SEA lifecycle waits indefinitely before the first connection', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const lifetime = new PageLifetime(() => count++);
  context.mock.timers.tick(60_000);
  assert.equal(count, 0);
  lifetime.dispose();
});
test('Closing last tab waits the standard two-second grace', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const lifetime = new PageLifetime(() => count++);
  lifetime.connect()();
  context.mock.timers.tick(PAGE_CLOSE_GRACE_MS - 1);
  assert.equal(count, 0);
  context.mock.timers.tick(1);
  assert.equal(count, 1);
  lifetime.dispose();
});
test('Multiple tabs, idempotent disconnect and refresh reconnect', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const lifetime = new PageLifetime(() => count++);
  const first = lifetime.connect();
  const second = lifetime.connect();
  first(); first();
  context.mock.timers.tick(PAGE_CLOSE_GRACE_MS);
  assert.equal(count, 0);
  second();
  context.mock.timers.tick(PAGE_CLOSE_GRACE_MS - 1);
  const refresh = lifetime.connect();
  context.mock.timers.tick(PAGE_CLOSE_GRACE_MS);
  assert.equal(count, 0);
  refresh();
  context.mock.timers.tick(PAGE_CLOSE_GRACE_MS);
  assert.equal(count, 1);
  lifetime.dispose();
});
test('Headless default has no shutdown callback or timer', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const lifetime = new PageLifetime();
  lifetime.connect()();
  context.mock.timers.tick(60_000);
  lifetime.dispose();
});
test('Disposal clears a pending shutdown and ignores late disconnects', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const lifetime = new PageLifetime(() => count++);
  const disconnect = lifetime.connect();
  disconnect(); lifetime.dispose(); disconnect(); lifetime.connect()();
  context.mock.timers.tick(60_000);
  assert.equal(count, 0);
});
