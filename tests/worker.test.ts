import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, link, rm, rename, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { W4WorkerStateAdapter } from '../backend/collectors/worker-state.js';
import { WorkerFiles, MAX_RECORD_BYTES } from '../backend/worker/files.js';
import { parseCheckpoints, parseScheduling, parseTask, parseService } from '../backend/worker/parsers.js';
import { parseBoundedJson, safeText } from '../backend/worker/validation.js';
import { summarizeWorker } from '../backend/worker/summary.js';
import { Monitor } from '../backend/monitor.js';
import { fixture, task, service, claim, checkpoints, scheduling, json, NOW, fakeProc, AT } from './fixtures/worker.js';
import { MachineCollector } from '../backend/collectors/machine.js';
import { ProcessCollector } from '../backend/collectors/processes.js';

test('Verified W4 DTOs project only safe fields and correctly combine tasks/checkpoints/scheduling', async context => {
  const root = await fixture(context); const adapter = new W4WorkerStateAdapter(root);
  const result = await adapter.read(NOW); const value = result.tasks.items[0]!;
  assert.equal(result.service?.state,'BUSY'); assert.equal(result.worker.format,'mx-feature-worker/w4-v1');
  assert.deepEqual(value.completedSteps,['code']); assert.equal(value.checkpoints[0]?.commit,'aaaaaaaaaaaa'); assert.equal(value.launches,2); assert.equal(value.failureAttempts,1); assert.equal(value.retries,null);
  assert.equal(result.evidence.length,3); assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|run_dir|token|\.env/);
});
test('Worker status requires fresh service heartbeat and live PID/start/boot identity', async context => {
  const root = await fixture(context), proc = fakeProc(), adapter = new W4WorkerStateAdapter(root);
  const result = await adapter.read(NOW), processes = await proc.collector.collect(result.evidence,NOW);
  const value = summarizeWorker(result,processes,NOW);
  assert.equal(value.status,'BUSY'); assert.equal(value.current?.requestedModel,'opus'); assert.equal(value.identityVerified,true); assert.equal(value.counts?.active,1);
  assert.equal(result.tasks.items[0]?.status,'running'); assert.equal(value.durationSeconds,60);
  assert.equal(summarizeWorker(result,processes,NOW+100_000).status,'STALE');
  proc.values.delete('200/stat'); const dead = await proc.collector.collect(result.evidence,NOW);
  assert.equal(summarizeWorker(result,dead,NOW).status,'OFFLINE'); assert.equal(summarizeWorker(result,dead,NOW).current,null);
  assert.equal(result.worker.persistedState,'BUSY');
});
test('Unsupported, malformed and incomplete schemas never invent LIVE status or clear freshness errors', async context => {
  const root = await fixture(context), adapter = new W4WorkerStateAdapter(root,1);
  await json(root,'service','worker',{...service(),schema_version:99});
  assert.equal((await adapter.read(NOW)).worker.source.status,'unsupported');
  await json(root,'service','worker',service()); assert.equal((await adapter.read(NOW+10)).worker.source.status,'ok');
  await writeFile(join(root,'service','worker.json'),'{');
  const stale = await adapter.read(NOW+20); assert.equal(stale.worker.source.status,'stale'); assert.equal(stale.service,null); assert.equal(stale.worker.current,null);
  assert.throws(()=>parseService({schema_version:1,state:'BUSY'}));
  assert.throws(()=>parseTask({...task(),schema_version:3},'task-a',NOW));
  assert.throws(()=>parseTask({...task(),unexpected:'private'},'task-a',NOW));
});
test('Task v1 is supported explicitly; checkpoint supersession, dependencies and scheduling are honest', () => {
  const legacy: Record<string,unknown> = {...task(),schema_version:1}; delete legacy.steps;
  assert.deepEqual(parseTask(legacy,'task-a',NOW).steps,[]);
  const record = checkpoints(); record.checkpoints[0]!.status='superseded';
  assert.deepEqual(parseCheckpoints(record,'task-a','feature-a','backend').completedSteps,[]);
  const wait = {...scheduling(),next_attempt_at:NOW/1000+300,waiting:{category:'subscription',reason:'usage limit',since:AT,until:AT}};
  assert.equal(parseScheduling(wait,'task-a','feature-a').nextAttemptAt,new Date(NOW+300_000).toISOString());
  assert.throws(()=>parseCheckpoints({...record,task_id:'other'},'task-a','feature-a','backend'));
});
test('Missing/unreadable/unsafe state directory is isolated and never created', async context => {
  const root = await fixture(context), missing = join(root,'not-present');
  const result = await new W4WorkerStateAdapter(missing).read(NOW);
  assert.equal(result.worker.directory,'missing'); assert.equal(result.worker.status,'unavailable');
  await assert.rejects(readFile(missing));
  await symlink(root,join(root,'linked-root'));
  const unsafe = await new W4WorkerStateAdapter(join(root,'linked-root')).read(NOW); assert.equal(unsafe.worker.directory,'unreadable');
  assert.equal((await new W4WorkerStateAdapter(root,1,'darwin').read(NOW)).worker.source.status,'unsupported');
});
test('Safe reader refuses traversal, symlink files/directories, oversized records, nesting and unexpected file kinds', async context => {
  const root = await fixture(context), outside = await fixture(context);
  const files = await WorkerFiles.open(root); context.after(()=>files.close());
  await assert.rejects(files.json('tasks','../auth'));
  await rm(join(root,'tasks','task-a.json')); await symlink(join(outside,'tasks','task-a.json'),join(root,'tasks','task-a.json'));
  await assert.rejects(files.json('tasks','task-a'));
  await rm(join(root,'tasks','task-a.json')); await mkdir(join(root,'tasks','task-a.json')); await assert.rejects(files.json('tasks','task-a'));
  await rm(join(root,'tasks','task-a.json'),{recursive:true}); await writeFile(join(root,'tasks','task-a.json'),'x'.repeat(MAX_RECORD_BYTES+1)); await assert.rejects(files.json('tasks','task-a'));
  await rm(join(root,'checkpoints'),{recursive:true}); await symlink(join(outside,'checkpoints'),join(root,'checkpoints')); await assert.rejects(files.json('checkpoints','task-a'));
  assert.throws(()=>parseBoundedJson('['.repeat(17)+'0'+']'.repeat(17)));
  assert.deepEqual(parseBoundedJson('{"text":"[[["}'),{text:'[[['});
});
test('FD-anchored directory handles prevent directory replacement escapes', async context => {
  const root = await fixture(context), outside = await fixture(context);
  const files = await WorkerFiles.open(root); context.after(()=>files.close());
  await rename(root,`${root}-moved`); context.after(()=>rm(`${root}-moved`,{recursive:true,force:true}));
  await symlink(outside,root);
  await json(outside,'tasks','task-a',{...task(),state:'failed'});
  assert.equal((await files.json('tasks','task-a') as {state:string}).state,'in-progress');
});
test('Task partial writes keep only explicitly stale last-known data and recover safely', async context => {
  const root = await fixture(context), adapter = new W4WorkerStateAdapter(root,1);
  await adapter.read(NOW); await writeFile(join(root,'tasks','task-a.json'),'{"schema_version":');
  const result = await adapter.read(NOW+10); assert.equal(result.tasks.source.status,'stale'); assert.equal(result.tasks.items[0]?.source.status,'stale');
  await json(root,'tasks','task-a',task()); assert.equal((await adapter.read(NOW+20)).tasks.source.status,'ok');
});
test('Free-text sanitization removes secrets, paths, controls, markup and prompt-like details', () => {
  const value = safeText('\u001b[31mError api_key=sk-1234567890 password=hunter2 token=abc /home/user/auth.json <script>alert(1)</script>');
  assert.doesNotMatch(value!,/sk-|hunter2|token=abc|\/home|<script>|\u001b/);
  assert.equal(safeText('full prompt: PRIVATE'),'Sensitive detail withheld.');
});
test('No evidence is attributed when records are absent; existing M0 monitor factory still works', async context => {
  const root = await fixture(context); await rm(join(root,'service','worker.json')); await rm(join(root,'claims','task-a.json'));
  const monitor = new Monitor(new W4WorkerStateAdapter(root)); const snapshot = await monitor.getSnapshot();
  assert.equal(snapshot.worker.status,'unavailable'); assert.equal(snapshot.processes.items.length,0); assert.equal(snapshot.worker.current,null);
  await monitor.close();
});
test('Hard-link fixture can be constructed without following links outside the configured root', async context => {
  const root = await fixture(context), outside = await fixture(context);
  await rm(join(root,'tasks','task-a.json')); await link(join(outside,'tasks','task-a.json'),join(root,'tasks','task-a.json'));
  // Shared-inode rejection is required alongside symlink refusal.
  const files = await WorkerFiles.open(root); context.after(()=>files.close()); await assert.rejects(files.json('tasks','task-a'));
});

test('Permission denied Worker directories are explicitly unreadable and safely recover', {skip:process.getuid?.()===0?'Root bypasses POSIX permission restrictions.':false}, async context=>{
  const root=await fixture(context); await chmod(root,0);
  try {
    const denied=await new W4WorkerStateAdapter(root).read(NOW); assert.equal(denied.worker.directory,'unreadable'); assert.equal(denied.worker.status,'unavailable');
  } finally { await chmod(root,0o700); }
  assert.equal((await new W4WorkerStateAdapter(root).read(NOW)).worker.directory,'available');
});
test('Unknown and denied claim identities never imply interrupted/dead or active tasks',async context=>{
  const root=await fixture(context), adapter=new W4WorkerStateAdapter(root), proc=fakeProc();
  const result=await adapter.read(NOW);
  const denied=new ProcessCollector(async()=>{throw Object.assign(new Error(),{code:'EACCES'});},async()=>({bootId:'11111111-2222-4333-8444-555555555555',uptime:1000,clockTicks:100,pageBytes:4096}));
  const summary=summarizeWorker(result,await denied.collect(result.evidence),NOW);
  assert.equal(summary.status,'UNKNOWN'); assert.equal(result.tasks.items[0]?.status,'unverified'); assert.equal(result.tasks.items[0]?.activeStep,null); assert.equal(summary.counts?.active,null);
  proc.values.delete('201/stat'); const orphan=await adapter.read(NOW+1);
  summarizeWorker(orphan,await proc.collector.collect(orphan.evidence),NOW+1); assert.equal(orphan.tasks.items[0]?.status,'orphaned');
});
test('Scheduling waits, dependency checks, missing timestamps and future heartbeat remain explicit',async context=>{
  const root=await fixture(context), value={...task(),state:'ready',depends_on:['missing-dependency']};
  await json(root,'tasks','task-a',value);
  await json(root,'scheduling','task-a',{...scheduling(),next_attempt_at:NOW/1000+500,waiting:{category:'subscription',reason:'limit',since:AT,until:AT}});
  let observation=await new W4WorkerStateAdapter(root).read(NOW);
  assert.equal(observation.tasks.items[0]?.status,'waiting-subscription'); assert.deepEqual(observation.tasks.items[0]?.waitingOn,['missing-dependency']);
  await json(root,'service','worker',{...service(),heartbeat_at:new Date(NOW+10_000).toISOString()});
  observation=await new W4WorkerStateAdapter(root).read(NOW); assert.equal(summarizeWorker(observation,await fakeProc().collector.collect(observation.evidence),NOW).status,'STALE');
});
test('Record caps and per-cycle budgets are reported rather than silently inventing complete counts',async context=>{
  const root=await fixture(context);
  for(let i=0;i<130;i++) await json(root,'tasks',`task-${i}`,{...task(),id:`task-${i}`,state:'ready'});
  const value=await new W4WorkerStateAdapter(root).read(NOW); assert(value.tasks.items.length<=128); assert(value.tasks.truncated); assert.equal(value.tasks.source.status,'stale');
  const files=await WorkerFiles.open(root,-1); context.after(()=>files.close()); await assert.rejects(files.json('tasks','task-a'));
});
test('Unexpected machine/process collector errors become typed partial failures, not API crashes',async context=>{
  class BrokenMachine extends MachineCollector { override async collect(): Promise<never>{throw new Error('SECRET');} }
  class BrokenProcesses extends ProcessCollector { override async collect(): Promise<never>{throw new Error('SECRET');} }
  const root=await fixture(context), monitor=new Monitor(new W4WorkerStateAdapter(root),new BrokenMachine(),{processes:new BrokenProcesses()});
  const snapshot=await monitor.getSnapshot(); assert.equal(snapshot.machine.source.status,'error'); assert.equal(snapshot.processes.source.status,'error'); assert.equal(snapshot.worker.status,'UNKNOWN'); assert.doesNotMatch(JSON.stringify(snapshot),/SECRET/); await monitor.close();
});

test('Conflicting service/claim records for the same PID cannot borrow one another\'s valid identity',async context=>{
  const root=await fixture(context);
  await json(root,'claims','task-a',{...claim(),identity:{...claim().identity,pid:200,start_ticks:999}});
  let observation=await new W4WorkerStateAdapter(root).read(NOW);
  let processes=await fakeProc().collector.collect(observation.evidence,NOW);
  let summary=summarizeWorker(observation,processes,NOW);
  assert.equal(summary.status,'BUSY'); assert.equal(observation.tasks.items[0]?.liveIdentityVerified,false); assert.equal(observation.tasks.items[0]?.status,'orphaned');
  await json(root,'service','worker',{...service(),identity:{...service().identity,start_ticks:999}});
  await json(root,'claims','task-a',{...claim(),identity:{...claim().identity,pid:200,start_ticks:100}});
  observation=await new W4WorkerStateAdapter(root).read(NOW);processes=await fakeProc().collector.collect(observation.evidence,NOW);summary=summarizeWorker(observation,processes,NOW);
  assert.equal(summary.status,'OFFLINE');assert.equal(summary.current,null);assert.equal(observation.tasks.items[0]?.liveIdentityVerified,true);
});
