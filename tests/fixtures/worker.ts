import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { TestContext } from 'node:test';
import { ProcessCollector, type ProcRead } from '../../backend/collectors/processes.js';

// Synthetic only. Field shapes verified from the local Worker to_dict writers.
export const BOOT = '11111111-2222-4333-8444-555555555555';
export const NOW = Date.parse('2026-10-23T12:00:00.000Z');
export const AT = new Date(NOW).toISOString();
export const identity = (pid = 200, start_ticks = 100) => ({ pid, start_ticks, boot_id: BOOT });
export const feature = () => ({ schema_version: 1, id: 'feature-a', slug: 'feature-a', title: 'PRIVATE PROMPT DO NOT EXPOSE', base_branch: 'dev', branch: 'feature/a',
  state: 'active', task_ids: ['task-a'], revision: 1, acceptance: [], base_sha: '', issue_number: null, pull_request: null, integration_evidence: null, merged_sha: null, test: true, workspace: {}, history: [] });
export const task = () => ({ schema_version: 2, id: 'task-a', feature_id: 'feature-a', role: 'backend', title: 'PRIVATE PROMPT DO NOT EXPOSE', state: 'in-progress',
  acceptance: ['PRIVATE PROMPT'], depends_on: [], required_gates: [], provides_contract: false, grants: [], blocked_reason: '', evidence: null, commits: [], issue_number: null,
  history: [{ at: AT, from_state: 'ready', to_state: 'in-progress', reason: 'SECRET_TOKEN_DO_NOT_EXPOSE' }], revision: 1, steps: [{ key: 'code', title: 'PRIVATE PROMPT' }, { key: 'test', title: 'PRIVATE PROMPT' }] });
export const service = () => ({ schema_version: 1, id: 'worker', worker_id: 'worker-test', state: 'BUSY', state_since: AT, reason: 'running task-a',
  identity: identity(), host: 'synthetic-host', instance: 'synthetic-instance', started_at: new Date(NOW - 60_000).toISOString(), heartbeat_at: AT,
  current: { feature: 'feature-a', task: 'task-a', role: 'backend', agent: 'claude', model: 'opus', launch: 2, started_at: AT, step: 'test' },
  last_error: null, last_checkpoint: { task: 'task-a', checkpoint: 'task-a.cp1.abc', step: 'code', commit: 'a'.repeat(40), at: AT }, counters: { success: 1 }, revision: 1 });
export const claim = () => ({ task_id: 'task-a', feature_id: 'feature-a', role: 'backend', token: 'SECRET_CLAIM_DO_NOT_EXPOSE', identity: identity(201, 110), branch: 'feature/a', head_sha: 'a'.repeat(40),
  acquired_at: AT, heartbeat_at: AT, checkpoint: { phase: 'agent', step: 'test', agent: identity(202, 120), run_tag: 'PRIVATE_TAG', run_dir: '/private/transcript' } });
export const scheduling = () => ({ schema_version: 1, task_id: 'task-a', feature_id: 'feature-a', launches: 2, attempts: { transient: 1 }, next_attempt_at: null,
  waiting: null, attention: null, in_flight: { launch: 2, instance: 'synthetic-instance', worker_id: 'worker-test', started_at: AT, tag: 'PRIVATE_TAG' }, history: [], revision: 1 });
export const checkpoints = () => ({ schema_version: 1, task_id: 'task-a', feature_id: 'feature-a', role: 'backend', steps: ['code','test'], checkpoints: [{
  id: 'task-a.cp1.abc', sequence: 1, step: 'code', status: 'committed', attempt: 'PRIVATE_CLAIM', agent: 'claude', model: 'opus', role: 'backend', base: 'b'.repeat(40), commit: 'a'.repeat(40),
  files: { '.env': 'PRIVATE_HASH' }, completed_steps: ['code'], remaining_steps: ['test'], verification: {}, summary: 'PRIVATE PROMPT', note: 'SECRET_TOKEN_DO_NOT_EXPOSE', created_at: AT, committed_at: AT, local: { run_dir: '/private/transcript' },
}], verifications: [], revision: 1 });
export const event = (kind = 'worker-started', at = AT) => ({ at, kind, task: 'task-a', feature: 'feature-a', reason: '<script>SECRET_TOKEN_DO_NOT_EXPOSE</script>', prompt: 'PRIVATE PROMPT', environment: { SECRET: 'PRIVATE' } });

export async function fixture(context?: TestContext): Promise<string> {
  await mkdir('build/test-fixtures', { recursive: true });
  const root = await mkdtemp(resolve('build/test-fixtures/w4-'));
  context?.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['features','tasks','service','claims','checkpoints','scheduling']) await mkdir(join(root, kind));
  await Promise.all([json(root,'features','feature-a',feature()), json(root,'tasks','task-a',task()), json(root,'service','worker',service()),
    json(root,'claims','task-a',claim()), json(root,'checkpoints','task-a',checkpoints()), json(root,'scheduling','task-a',scheduling()),
    writeFile(join(root,'events.jsonl'), JSON.stringify(event()) + '\n'), writeFile(join(root,'auth'), 'PRIVATE_AUTH'), writeFile(join(root,'transcript'), 'PRIVATE PROMPT')]);
  return root;
}
export async function json(root: string, kind: string, name: string, value: unknown): Promise<void> { await writeFile(join(root,kind,`${name}.json`), JSON.stringify(value)); }
export function stat(pid: number, ppid: number, start = 100, ticks = 10, name = 'worker (safe)', state = 'S'): string {
  const fields = Array<string>(50).fill('0'); fields[0] = state; fields[1] = String(ppid); fields[11] = String(ticks); fields[12] = '0'; fields[19] = String(start); fields[21] = '20';
  return `${pid} (${name}) ${fields.join(' ')}`;
}
export function fakeProc() {
  let elapsed = 1000;
  const calls: string[] = [];
  const values = new Map<string, string>([
    ['200/stat', stat(200, 1)], ['201/stat', stat(201, 200, 110)], ['202/stat', stat(202, 201, 120, 10, 'claude')],
    ['203/stat', stat(203, 202, 130, 10, 'agent child')], ['999/stat', stat(999, 1, 40, 10, 'claude')],
    ['200/task/200/children', '201'], ['201/task/201/children', '202'], ['202/task/202/children', '203'],
  ]);
  const read: ProcRead = async path => {
    calls.push(path);
    if (values.has(path)) return Buffer.from(values.get(path)!);
    if (path.endsWith('/children')) return Buffer.from('');
    throw Object.assign(new Error('Unavailable'), { code: 'ENOENT' });
  };
  return { values, read, calls, time: (value: number) => { elapsed = value; }, collector: new ProcessCollector(read, async () => ({ bootId: BOOT, uptime: 1000, clockTicks: 100, pageBytes: 4096 }), () => elapsed, 'linux') };
}
