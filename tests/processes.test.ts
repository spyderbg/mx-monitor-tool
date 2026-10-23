import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuxv, parseProcessStat, ProcessCollector, procContext, type ProcessEvidence } from '../backend/collectors/processes.js';
import { BOOT, fakeProc, stat } from './fixtures/worker.js';

const evidence: ProcessEvidence[] = [{ identity: { pid: 200, startTicks: 100, bootId: BOOT }, attribution: 'worker', taskId: null }];
test('Process stat correctly parses spaces/parentheses, CPU ticks, RSS and start time', () => {
  const value = parseProcessStat(stat(42, 7, 123, 456, 'name ) with ( spaces'), 42);
  assert.equal(value.name, 'name ) with ( spaces'); assert.equal(value.startTicks, 123); assert.equal(value.ticks, 456); assert.equal(value.rssPages, 20); assert.equal(value.ppid, 7);
  assert.throws(() => parseProcessStat('42 (bad) S 1'));
  assert.throws(() => parseProcessStat(stat(42,7), 43));
});
test('auxv timing/page constants are decoded for 32/64-bit and endianness; missing values fail closed', () => {
  for (const word of [4,8]) for (const little of [true,false]) {
    const buffer = Buffer.alloc(word * 6);
    [17,100,6,4096,0,0].forEach((value,index) => {
      if (word === 8) little ? buffer.writeBigUInt64LE(BigInt(value), index * word) : buffer.writeBigUInt64BE(BigInt(value), index * word);
      else little ? buffer.writeUInt32LE(value,index * word) : buffer.writeUInt32BE(value,index * word);
    });
    assert.deepEqual(parseAuxv(buffer,word,little),{clockTicks:100,pageBytes:4096});
  }
  assert.throws(() => parseAuxv(Buffer.alloc(16)));
});
test('Real Linux boot identity and kernel timing are available without subprocesses', async () => {
  const value = await procContext(); assert.match(value.bootId,/^[a-f0-9-]{36}$/); assert(value.clockTicks > 0); assert(value.pageBytes > 0); assert(value.uptime > 0);
});
test('Identity-verified tree follows known children, never a same-named unrelated agent', async () => {
  const proc = fakeProc(); const result = await proc.collector.collect(evidence);
  assert.deepEqual(result.items.map(value => value.pid),[200,201,202,203]);
  assert.equal(result.items[0]?.attribution,'worker'); assert.equal(result.items[2]?.parentPid,201);
  assert(!proc.calls.includes('999/stat')); assert(proc.calls.every(path => !/environ|cmdline|\/fd/.test(path)));
});
test('Process CPU is elapsed tick delta, not lifetime ticks; warmup and RSS are truthful', async () => {
  const proc = fakeProc(); const first = await proc.collector.collect(evidence);
  assert.equal(first.items[0]?.cpuPercent,null); assert.equal(first.items[0]?.rssBytes,81920); assert.equal(first.items[0]?.elapsedSeconds,999);
  proc.time(2000); proc.values.set('200/stat',stat(200,1,100,60));
  const second = await proc.collector.collect(evidence); assert.equal(second.items[0]?.cpuPercent,50);
});
test('PID reuse, boot mismatch and zombie identities are unverified and never parent linked', async () => {
  for (const variant of ['pid','boot','zombie']) {
    const proc = fakeProc();
    if (variant === 'pid') proc.values.set('200/stat',stat(200,1,999));
    if (variant === 'zombie') proc.values.set('200/stat',stat(200,1,100,10,'worker','Z'));
    const candidate = structuredClone(evidence); if (variant === 'boot') candidate[0]!.identity.bootId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const result = await proc.collector.collect(candidate);
    assert.equal(result.items.length,1); assert.equal(result.items[0]?.identityVerified,false); assert.equal(result.items[0]?.attribution,'unverified'); assert.equal(result.items[0]?.parentPid,null);
  }
});
test('Orphaned agent evidence remains attributable independently of dead launch; errors are partial', async () => {
  const proc = fakeProc(); proc.values.delete('201/stat');
  const result = await proc.collector.collect([
    {identity:{pid:201,startTicks:110,bootId:BOOT},attribution:'launch',taskId:'task-a'},
    {identity:{pid:202,startTicks:120,bootId:BOOT},attribution:'agent',taskId:'task-a'},
  ]);
  assert.equal(result.items.find(value => value.pid === 201)?.identityVerified,false);
  assert.equal(result.items.find(value => value.pid === 202)?.attribution,'agent'); assert.equal(result.items.find(value => value.pid === 202)?.parentPid,null);
  const denied = new ProcessCollector(async () => { throw Object.assign(new Error('/private/SECRET'),{code:'EACCES'}); }, async () => ({bootId:BOOT,uptime:100,clockTicks:100,pageBytes:4096}));
  const partial = await denied.collect(evidence); assert.equal(partial.source.status,'stale'); assert.doesNotMatch(JSON.stringify(partial),/SECRET|private/);
});
test('Reparenting and process changes during traversal do not produce false child attribution', async () => {
  const proc = fakeProc(); proc.values.set('201/stat',stat(201,999,110));
  const result = await proc.collector.collect(evidence); assert.deepEqual(result.items.map(item => item.pid),[200]);
});
test('Process record, depth and time limits bound traversal; non-Linux and unavailable context are explicit', async () => {
  const proc = fakeProc(); proc.values.set('200/task/200/children',Array.from({length:100},(_,i)=>String(i+300)).join(' '));
  for (let i=300;i<400;i++) proc.values.set(`${i}/stat`,stat(i,200,200));
  const bounded = await proc.collector.collect(evidence); assert(bounded.items.length <=64); assert.equal(bounded.truncated,true);
  assert.equal((await new ProcessCollector(proc.read,async()=>{throw new Error();}).collect(evidence)).source.status,'unavailable');
  assert.equal((await new ProcessCollector(proc.read,undefined,undefined,'darwin').collect(evidence)).source.status,'unsupported');
});

test('Traversal checks its time budget between child reads rather than finishing an oversized branch',async()=>{
  const proc=fakeProc();proc.values.set('200/task/200/children','300 301 302');
  for(const pid of [300,301,302])proc.values.set(`${pid}/stat`,stat(pid,200,200));
  let time=0;
  const collector=new ProcessCollector(async(path,limit)=>{time+=60;return proc.read(path,limit);},async()=>({bootId:BOOT,uptime:1000,clockTicks:100,pageBytes:4096}),()=>time);
  const result=await collector.collect(evidence);assert.equal(result.truncated,true);assert(result.items.length<=2);
});
