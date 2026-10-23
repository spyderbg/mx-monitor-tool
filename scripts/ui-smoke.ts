import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createSSRApp, h, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { Monitor } from '../backend/monitor.js';
import { W4WorkerStateAdapter } from '../backend/collectors/worker-state.js';
import { source } from '../backend/observation.js';
import { fixture, fakeProc, NOW } from '../tests/fixtures/worker.js';
import type { MonitorSnapshot } from '../shared/api.js';

const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
const root = await fixture();
await mkdir('build/ui', { recursive: true });
after(async () => { await vite.close(); await rm(root, { recursive: true, force: true }); });
const monitor = new Monitor(new W4WorkerStateAdapter(root),undefined,{clock:()=>NOW,processes:fakeProc().collector});
const snapshot = await monitor.getSnapshot(); await monitor.close();
async function render(name: string, props: Record<string,unknown>, artifact?: string, label = 'SYNTHETIC VERIFIED-SCHEMA FIXTURE — COMPONENT CHECK, NOT A LIVE WORKER'): Promise<string> {
  const {default: component} = await vite.ssrLoadModule(`/src/components/${name}.vue`) as {default:Component};
  const html = await renderToString(createSSRApp({render:()=>h(component,props)}));
  if (artifact) {
    const css = await readFile('frontend/src/styles.css','utf8');
    await writeFile(`build/ui/${artifact}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${label}</title><style>${css}</style></head><body><main><p class="notice">${label}</p>${html}</main></body></html>`);
  }
  return html;
}
test('Overview renders real machine metrics and a clearly synthetic verified Worker example', async () => {
  const html = await render('OverviewDashboard',{snapshot},'fixture-overview');
  assert.match(html,/CPU UTILIZATION/); assert.match(html,/MEMORY/); assert.match(html,/BUSY/); assert.match(html,/identity/i);
  assert.doesNotMatch(html,/PRIVATE|SECRET|run_dir|\.env/);
});
test('Processes, tasks/checkpoints and events render the verified-schema fixture contracts', async () => {
  const processes = await render('ProcessTree',{section:snapshot.processes},'fixture-processes');
  assert.match(processes,/agent child/); assert.match(processes,/Collapse process/); assert.match(processes,/status-agent/);
  const tasks = await render('TaskList',{section:snapshot.tasks,features:snapshot.features},'fixture-tasks');
  assert.match(tasks,/aaaaaaaaaaaa/); assert.match(tasks,/Checkpoint history/); assert.match(tasks,/Failure attempts/);
  const events = await render('EventTimeline',{section:snapshot.events},'fixture-events');
  assert.match(events,/Worker service started/); assert.match(events,/Severity/); assert.doesNotMatch(processes+tasks+events,/PRIVATE|SECRET|<script/);
});
test('Unavailable, stale, permission error and empty views render without claiming success', async () => {
  const unavailable = source('unavailable',null,'State unavailable.');
  const empty = {source:unavailable,items:[],truncated:false};
  assert.match(await render('ProcessTree',{section:empty}),/No attributable Worker process/);
  assert.match(await render('TaskList',{section:empty,features:empty}),/No validated task records/);
  assert.match(await render('EventTimeline',{section:empty}),/Events unavailable/);
  const stale: MonitorSnapshot = structuredClone(snapshot); stale.worker.status='STALE'; stale.worker.current=null; stale.worker.source=source('stale',null,'Heartbeat stale.');
  const html = await render('WorkerStatus',{worker:stale.worker},'fixture-stale'); assert.match(html,/Heartbeat stale/); assert.doesNotMatch(html,/VERIFIED CURRENT RUN/);
  const denied = await render('ProcessTree',{section:{...empty,source:source('error',null,'Permission denied.')}}); assert.match(denied,/Permission denied/);
});
test('Vue escapes malicious strings even if a DTO is supplied directly to a component', async () => {
  const changed = structuredClone(snapshot.events); changed.items[0]!.summary='<img src=x onerror=alert(1)>';
  const html = await render('EventTimeline',{section:changed}); assert.doesNotMatch(html,/<img/); assert.match(html,/&lt;img/);
});
test('Real host sample renders independently of Worker availability', async () => {
  const actual = new Monitor(new W4WorkerStateAdapter());
  try {
    const value = await actual.getSnapshot();
    assert.equal(value.machine.source.status,'ok'); assert((value.machine.memory?.totalBytes ?? 0)>0);
    await render('OverviewDashboard',{snapshot:value},'real-machine-overview','REAL MACHINE SAMPLE — READ-ONLY OBSERVATION; WORKER STATUS IS AS OBSERVED');
    await writeFile('build/ui/real-machine-snapshot.json',JSON.stringify(value,null,2));
  } finally { await actual.close(); }
});
