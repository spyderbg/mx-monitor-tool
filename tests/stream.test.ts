import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../backend/server.js';
import { Monitor } from '../backend/monitor.js';
import { MachineCollector } from '../backend/collectors/machine.js';
import { W4WorkerStateAdapter } from '../backend/collectors/worker-state.js';
import { MAX_STREAM_PENDING_BYTES, MAX_STREAM_SUBSCRIBERS } from '../shared/config.js';
import { writeStream } from '../backend/monitor-stream.js';
import type { MonitorSnapshot, StreamEnvelope } from '../shared/api.js';
import { fixture, fakeProc } from './fixtures/worker.js';

async function session(origin: string): Promise<string> { return (await fetch(`${origin}/api/session`)).headers.get('set-cookie')!.split(';')[0]!; }
export function frames(response: Response) {
  const reader = response.body!.getReader(); let buffer = '';
  return { reader, async next(type = 'snapshot'): Promise<string> {
    const end = Date.now()+5000;
    while (Date.now()<end) {
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0,index); buffer = buffer.slice(index+2);
        if (frame.includes(`event: ${type}\n`)) return frame.split('\n').find(line=>line.startsWith('data: '))!.slice(6);
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const data = await Promise.race([reader.read(), new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('Stream read timed out.')),5000);})]).finally(()=>clearTimeout(timeout));
      if(data.done) throw new Error('Stream ended before expected event.');
      buffer += new TextDecoder().decode(data.value);
    }
    throw new Error('Timed out waiting for stream event.');
  } };
}
async function tree(root: string, prefix = ''): Promise<Record<string,string>> {
  const result: Record<string,string> = {};
  for (const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const key = join(prefix,entry.name);
    if (entry.isDirectory()) { result[`${key}/`]='directory'; Object.assign(result,await tree(root,key)); }
    else result[key]=createHash('sha256').update(await readFile(join(root,key))).digest('hex');
  }
  return result;
}

test('Monitoring SSE uses M0 auth/origin protection and initial coherent full snapshots', async context => {
  const root = await fixture(context), proc = fakeProc();
  const monitor = new Monitor(new W4WorkerStateAdapter(root),undefined,{sampleMs:30,processes:proc.collector});
  const server = await createServer({monitor,heartbeatMs:20}); const origin = await server.listen({host:'127.0.0.1',port:0}); context.after(()=>server.close());
  assert.equal((await fetch(`${origin}/api/stream`)).status,401);
  const cookie = await session(origin);
  assert.equal((await fetch(`${origin}/api/stream`,{headers:{cookie,origin:'http://evil.test','sec-fetch-site':'cross-site'}})).status,403);
  const controller = new AbortController(); context.after(()=>controller.abort());
  const response = await fetch(`${origin}/api/stream`,{headers:{cookie},signal:controller.signal});
  assert.equal(response.headers.get('cache-control'),'no-store'); assert.match(response.headers.get('content-security-policy')!,/default-src 'none'/);
  const stream = frames(response), first = JSON.parse(await stream.next()) as StreamEnvelope;
  assert.equal(first.snapshot.tasks.items[0]?.id,'task-a'); assert.equal(first.snapshot.diagnostics.streamSubscribers,1);
  const heartbeat = JSON.parse(await stream.next('heartbeat')) as {sequence:number}; assert(heartbeat.sequence>=first.sequence);
  const second = JSON.parse(await stream.next()) as StreamEnvelope; assert(second.sequence>first.sequence); assert(second.snapshot.revision>=first.snapshot.revision);
  controller.abort(); await stream.reader.cancel().catch(()=>{}); await delay(50);
  assert.equal(monitor.diagnostics().streamSubscribers,0); assert.equal(monitor.diagnostics().collectorRunning,false);
  const reconnect = new AbortController(); context.after(()=>reconnect.abort());
  const again = frames(await fetch(`${origin}/api/stream`,{headers:{cookie,'last-event-id':'999999'},signal:reconnect.signal}));
  const resync = JSON.parse(await again.next()) as StreamEnvelope;
  assert.equal(resync.serverId,first.serverId); assert(resync.sequence>second.sequence); assert(resync.snapshot.machine.memory);
  const later = JSON.parse(await again.next()) as StreamEnvelope; assert(later.sequence>resync.sequence);
  reconnect.abort(); await again.reader.cancel().catch(()=>{});
});
test('Snapshot polling and SSE leave fixture bytes and tree structure unchanged', async context => {
  const root = await fixture(context), before = await tree(root);
  const server = await createServer({workerStateDir:root,sampleMs:20,taskSampleMs:30}); const origin = await server.listen({host:'127.0.0.1',port:0}); context.after(()=>server.close());
  const cookie = await session(origin), controller = new AbortController(); context.after(()=>controller.abort());
  const stream = frames(await fetch(`${origin}/api/stream`,{headers:{cookie},signal:controller.signal}));
  await stream.next(); await stream.next();
  for(let i=0;i<3;i++) {
    const response = await fetch(`${origin}/api/snapshot?path=/etc/passwd`,{headers:{cookie}});
    assert.equal(response.status,200); const snapshot = await response.text(); assert.doesNotMatch(snapshot,/PRIVATE|SECRET|run_dir|head_sha|root:x:/);
  }
  controller.abort(); await stream.reader.cancel().catch(()=>{}); await server.close();
  assert.deepEqual(await tree(root),before);
});
test('Collection is shared across subscribers, capacity is capped, and all timers stop on last disconnect', async context => {
  class Counted extends MachineCollector { calls=0; override async collect() { this.calls++; return super.collect(); } }
  const machine = new Counted(), monitor = new Monitor({status:'not_configured',source:{status:'unavailable',observedAt:null,lastSuccessfulAt:null,detail:null}},machine,{sampleMs:40});
  const server = await createServer({monitor,heartbeatMs:30}), origin = await server.listen({host:'127.0.0.1',port:0});
  const controllers: AbortController[]=[]; context.after(async()=>{controllers.forEach(c=>c.abort());await server.close();});
  const cookie = await session(origin);
  await Promise.all(Array.from({length:MAX_STREAM_SUBSCRIBERS},async()=>{
    const controller = new AbortController(); controllers.push(controller);
    assert.equal((await fetch(`${origin}/api/stream`,{headers:{cookie},signal:controller.signal})).status,200);
  }));
  assert(machine.calls<MAX_STREAM_SUBSCRIBERS); assert.equal(monitor.diagnostics().streamSubscribers,MAX_STREAM_SUBSCRIBERS);
  assert.equal((await fetch(`${origin}/api/stream`,{headers:{cookie}})).status,503);
  controllers.forEach(controller=>controller.abort()); await delay(100);
  assert.equal(monitor.diagnostics().streamSubscribers,0); const stopped = machine.calls; await delay(100); assert.equal(machine.calls,stopped);
  const snapshot = await monitor.getSnapshot(); assert.equal(snapshot.diagnostics.collectorRunning,false);
});
test('Backpressure permits ordinary high-water marks but never exceeds the bounded output queue', () => {
  const sink = {writableLength:0,destroyed:false,write(frame:string){this.writableLength+=Buffer.byteLength(frame);return false;},destroy(){this.destroyed=true;}};
  assert.equal(writeStream(sink,'large but accepted'),true); assert.equal(sink.destroyed,false);
  sink.writableLength=MAX_STREAM_PENDING_BYTES; assert.equal(writeStream(sink,'next'),false); assert.equal(sink.destroyed,true);
  const throws={writableLength:0,destroyed:false,write(){throw new Error('Disconnected');},destroy(){this.destroyed=true;}};
  assert.equal(writeStream(throws,'next'),false); assert.equal(throws.destroyed,true);
});

test('A subscriber joining an in-flight shared cycle receives hardened headers before any broadcast',async context=>{
  let release=()=>{}; const gate=new Promise<void>(resolve=>{release=resolve;});
  let secondStarted=()=>{}; const started=new Promise<void>(resolve=>{secondStarted=resolve;});
  class Delayed extends MachineCollector { calls=0; override async collect(){this.calls++;if(this.calls===2){secondStarted();await gate;}return super.collect();} }
  const monitor=new Monitor({status:'not_configured',source:{status:'unavailable',observedAt:null,lastSuccessfulAt:null,detail:null}},new Delayed(),{sampleMs:20});
  const server=await createServer({monitor}),origin=await server.listen({host:'127.0.0.1',port:0});
  const one=new AbortController(),two=new AbortController(); context.after(async()=>{release();one.abort();two.abort();await server.close();});
  const cookie=await session(origin), first=frames(await fetch(`${origin}/api/stream`,{headers:{cookie},signal:one.signal}));await first.next();await started;
  const pending=fetch(`${origin}/api/stream`,{headers:{cookie},signal:two.signal});
  for(let i=0;i<50 && monitor.diagnostics().streamSubscribers!==2;i++)await delay(2);
  assert.equal(monitor.diagnostics().streamSubscribers,2);release();
  const response=await pending;assert.match(response.headers.get('content-type')!,/text\/event-stream/);assert.equal(response.headers.get('cache-control'),'no-store');
  const second=frames(response);assert((JSON.parse(await second.next()) as StreamEnvelope).snapshot.machine);
  one.abort();two.abort();await first.reader.cancel().catch(()=>{});await second.reader.cancel().catch(()=>{});
});
test('Shutdown closes active monitoring SSE promptly without a page-close callback', async context => {
  const server = await createServer(), origin = await server.listen({host:'127.0.0.1',port:0}); context.after(()=>server.close());
  const controller = new AbortController(); context.after(()=>controller.abort());
  const stream = frames(await fetch(`${origin}/api/stream`,{headers:{cookie:await session(origin)},signal:controller.signal})); await stream.next();
  await server.close(); controller.abort(); await stream.reader.cancel().catch(()=>{});
});
test('Client rejects duplicate/out-of-order frames and resynchronizes across server restart', async () => {
  const {StreamState} = await import('../frontend/src/monitor-state.js');
  const monitor = new Monitor({status:'not_configured',source:{status:'unavailable',observedAt:null,lastSuccessfulAt:null,detail:null}});
  const snapshot: MonitorSnapshot = await monitor.getSnapshot(); const state = new StreamState();
  const envelope: StreamEnvelope = {schemaVersion:1,sequence:5,serverId:'first',at:snapshot.observedAt,snapshot};
  assert.equal(state.accept(envelope),snapshot); assert.equal(state.accept(envelope),null); assert.equal(state.accept({...envelope,sequence:4}),null);
  assert.equal(state.accept({...envelope,sequence:1,serverId:'new',snapshot:{...snapshot,revision:1}})?.revision,1);
  assert.equal(state.accept({schemaVersion:9}),null); await monitor.close();
});
