import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { ENV_PREFIX } from '../shared/config.js';
import { Monitor } from '../backend/monitor.js';
import { W4WorkerStateAdapter } from '../backend/collectors/worker-state.js';
import { WorkerFiles } from '../backend/worker/files.js';

const configured = process.env[`${ENV_PREFIX}_WORKER_STATE_DIR`];
const root = configured ?? join(homedir(),'.local','state','mx-admin-agents');
async function fingerprint() {
  const result: Record<string,string> = {}; let files: WorkerFiles | undefined;
  try {
    files=await WorkerFiles.open(root,5000);
    try {result['service/worker.json']=await files.digest('service','worker');} catch { /* absent/unreadable stays absent, no writes */ }
    for(const kind of ['features','tasks','claims','checkpoints','scheduling'] as const) {
      try { const names=await files.names(kind,128); for(const name of names.ids) { try {result[`${kind}/${name}.json`]=await files.digest(kind,name);} catch {result[`${kind}/${name}.json`]='unreadable-or-over-limit';} } }
      catch { /* only known directories are probed */ }
    }
    try {
      const file=await files.eventFile();
      try {
        const info=await file.stat();
        if(info.size<=4*1024*1024) {
          const hash=createHash('sha256'), buffer=Buffer.alloc(64*1024); let offset=0;
          while(offset<info.size) {const part=await file.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!part.bytesRead)break;hash.update(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;}
          result['events.jsonl']=hash.digest('hex');
        } else result['events.jsonl']='over-observation-hash-limit';
      } finally {await file.close();}
    } catch { /* no event source */ }
  } catch {result['directory']='unavailable';}
  finally {await files?.close();}
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
const before=await fingerprint(), monitor=new Monitor(new W4WorkerStateAdapter(configured));
try {
  await monitor.getSnapshot(); await delay(1100); const snapshot=await monitor.getSnapshot(), after=await fingerprint();
  await mkdir('build',{recursive:true});
  const observation={observedAt:snapshot.observedAt,stateFilesFingerprinted:Object.keys(before).filter(name=>name!=='directory').length,
    unchanged:JSON.stringify(before)===JSON.stringify(after),before,after,
    note:'Read-only observation only. A concurrent Worker write can legitimately change the fingerprints; no Worker process was launched or controlled.'};
  await writeFile('build/real-machine-m1.json',JSON.stringify(snapshot,null,2));
  await writeFile('build/worker-observation-m1.json',JSON.stringify(observation,null,2));
  console.log(JSON.stringify({observedAt:snapshot.observedAt,cpuPercent:snapshot.machine.cpuPercent,memory:snapshot.machine.memory,load:snapshot.machine.loadAverage,
    workerStatus:snapshot.worker.status,workerDirectory:snapshot.worker.directory,format:snapshot.worker.format,taskCount:snapshot.tasks.items.length,
    stateFilesFingerprinted:observation.stateFilesFingerprinted,unchanged:observation.unchanged},null,2));
} finally {await monitor.close();}
