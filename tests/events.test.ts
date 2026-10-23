import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventTailer, parseEvent } from '../backend/worker/events.js';
import { WorkerFiles } from '../backend/worker/files.js';
import { fixture, event, NOW, AT } from './fixtures/worker.js';

test('Events project only verified fields and static sanitized summaries', () => {
  const value = parseEvent(event(), 'safe-hash');
  assert.equal(value?.summary,'Worker service started'); assert.equal(value?.taskId,'task-a');
  assert.doesNotMatch(JSON.stringify(value),/SECRET|PRIVATE|script|environment|reason/);
  assert.equal(parseEvent({...event(),kind:'unknown-new-kind'},'hash'),null);
  assert.equal(parseEvent({...event(),at:'bad-time'},'hash'),null);
  assert.equal(parseEvent({...event(),task:'<script>alert(1)</script>'},'hash')?.taskId,null);
});
test('JSONL partial final lines, duplicate entries and timestamp disorder are handled incrementally', async context => {
  const root = await fixture(context), files = await WorkerFiles.open(root,10_000), tail = new EventTailer(); context.after(()=>files.close());
  const first = JSON.stringify(event()); const second = JSON.stringify(event('checkpoint-committed',new Date(NOW+1000).toISOString()));
  await writeFile(join(root,'events.jsonl'),first+'\n'+second.slice(0,20));
  assert.equal((await tail.collect(files,NOW)).items.length,1);
  await appendFile(join(root,'events.jsonl'),second.slice(20)+'\n'+first+'\n');
  const result = await tail.collect(files,NOW+1000); assert.equal(result.items.length,2); assert.equal(result.items[0]?.type,'checkpoint-committed');
  assert.equal((await tail.collect(files,NOW+2000)).items.length,2);
});
test('Events survive safe rotation/truncation and reject malformed, oversized, unsupported lines', async context => {
  const root = await fixture(context), files = await WorkerFiles.open(root,10_000), tail = new EventTailer(); context.after(()=>files.close());
  await tail.collect(files,NOW);
  await rename(join(root,'events.jsonl'),join(root,'events.old'));
  await writeFile(join(root,'events.jsonl'),JSON.stringify(event('worker-stopped',new Date(NOW+1000).toISOString()))+'\n');
  assert.equal((await tail.collect(files,NOW+1000)).items.length,2);
  await writeFile(join(root,'events.jsonl'),'bad\n'+JSON.stringify(event('claim',new Date(NOW+2000).toISOString()))+'\n');
  const truncated = await tail.collect(files,NOW+2000); assert(truncated.items.some(value=>value.type==='claim')); assert.equal(truncated.source.status,'stale');
  await appendFile(join(root,'events.jsonl'),'x'.repeat(20_000)+'\n'+JSON.stringify({kind:'new-kind',at:AT})+'\n');
  assert.equal((await tail.collect(files,NOW+3000)).source.status,'stale');
  await rm(join(root,'events.jsonl')); assert.equal((await tail.collect(files,NOW+4000)).source.status,'stale');
});
test('Event history, long incomplete lines and initial tail reads stay bounded', async context => {
  const root = await fixture(context), files = await WorkerFiles.open(root,10_000), tail = new EventTailer(); context.after(()=>files.close());
  await writeFile(join(root,'events.jsonl'),Array.from({length:220},(_,i)=>JSON.stringify(event('worker-state',new Date(NOW+i*1000).toISOString()))).join('\n')+'\n'+'x'.repeat(17_000));
  const result = await tail.collect(files,NOW); assert.equal(result.items.length,100); assert.equal(result.truncated,true);
  await appendFile(join(root,'events.jsonl'),'\n'+JSON.stringify(event('worker-stopped',new Date(NOW+300_000).toISOString()))+'\n');
  const next = await tail.collect(files,NOW+1); assert.equal(next.items[0]?.type,'worker-stopped'); assert.equal(next.items.length,100);
});
