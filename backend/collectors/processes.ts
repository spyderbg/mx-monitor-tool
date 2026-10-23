import { open } from 'node:fs/promises';
import { endianness } from 'node:os';
import type { DataSection, ObservedProcess, ProcessAttribution } from '../../shared/api.js';
import { MAX_PROCESSES } from '../../shared/config.js';
import { source } from '../observation.js';
import { safeText } from '../worker/validation.js';

export interface ProcessIdentity { pid: number; startTicks: number; bootId: string }
export interface ProcessEvidence { identity: ProcessIdentity; attribution: 'worker' | 'launch' | 'agent'; taskId: string | null }
export interface ProcessStat { pid: number; ppid: number; name: string; state: string; ticks: number; startTicks: number; rssPages: number }
export interface ProcContext { bootId: string; uptime: number; clockTicks: number; pageBytes: number }
export type ProcRead = (path: string, maximum?: number) => Promise<Buffer>;
export async function readProcFile(path: string, maximum = 16 * 1024): Promise<Buffer> {
  if (!/^(?:sys\/kernel\/random\/boot_id|uptime|self\/auxv|[1-9]\d*\/(?:stat|task\/[1-9]\d*\/children))$/.test(path)) throw new Error('Invalid proc source.');
  const handle = await open(`/proc/${path}`, 'r');
  try {
    const buffer = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximum) throw new Error('Proc source exceeds limit.');
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
export function parseProcessStat(text: string, expectedPid?: number): ProcessStat {
  const first = text.indexOf('('), last = text.lastIndexOf(')');
  if (first < 1 || last <= first) throw new Error('Malformed process stat.');
  const pid = Number(text.slice(0, first).trim());
  const fields = text.slice(last + 1).trim().split(/\s+/);
  const numeric = (index: number): number => {
    const value = fields[index];
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Malformed process stat.');
    return Number(value);
  };
  if (!Number.isSafeInteger(pid) || pid < 1 || (expectedPid !== undefined && pid !== expectedPid) || !/^[A-Za-z]$/.test(fields[0] ?? '')) throw new Error('Malformed process stat.');
  return { pid, name: safeText(text.slice(first + 1, last), 40) ?? 'unnamed', state: fields[0]!, ppid: numeric(1),
    ticks: numeric(11) + numeric(12), startTicks: numeric(19), rssPages: numeric(21) };
}
export function parseAuxv(buffer: Buffer, wordBytes = process.arch === 'ia32' || process.arch === 'arm' ? 4 : 8, littleEndian = endianness() === 'LE'): Pick<ProcContext, 'clockTicks' | 'pageBytes'> {
  let clockTicks = 0, pageBytes = 0;
  const number = (offset: number): number => wordBytes === 8 ? Number(littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset)) : littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  for (let offset = 0; offset + wordBytes * 2 <= buffer.length; offset += wordBytes * 2) {
    const key = number(offset), value = number(offset + wordBytes);
    if (key === 0) break;
    if (key === 17) clockTicks = value; // AT_CLKTCK, no subprocess/sysconf guesses.
    if (key === 6) pageBytes = value; // AT_PAGESZ.
  }
  if (!Number.isSafeInteger(clockTicks) || clockTicks <= 0 || !Number.isSafeInteger(pageBytes) || pageBytes <= 0) throw new Error('Kernel timing metadata unavailable.');
  return { clockTicks, pageBytes };
}
export async function procContext(read: ProcRead = readProcFile): Promise<ProcContext> {
  const [boot, uptime, auxv] = await Promise.all([read('sys/kernel/random/boot_id', 128), read('uptime', 256), read('self/auxv', 4096)]);
  const bootId = boot.toString().trim(), seconds = Number(uptime.toString().trim().split(/\s+/)[0]);
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(bootId) || !Number.isFinite(seconds) || seconds < 0) throw new Error('Kernel identity unavailable.');
  return { bootId, uptime: seconds, ...parseAuxv(auxv) };
}

export class ProcessCollector {
  private previous = new Map<string, { ticks: number; time: number }>();
  constructor(private readonly read: ProcRead = readProcFile, private readonly context = () => procContext(read), private readonly clock = () => performance.now(), private readonly hostPlatform = process.platform) {}
  async collect(evidence: ProcessEvidence[], now = Date.now()): Promise<DataSection<ObservedProcess>> {
    if (this.hostPlatform !== 'linux') return { source: source('unsupported', null, 'Process observation requires Linux.'), items: [], truncated: false };
    let context: ProcContext;
    try { context = await this.context(); }
    catch { this.previous.clear(); return { source: source('unavailable', null, 'Kernel process identity or timing metadata is unavailable.'), items: [], truncated: false }; }
    const observedAt = new Date(now).toISOString(), started = this.clock();
    const rows = new Map<number, ObservedProcess>(), stats = new Map<number, ProcessStat>();
    const next = new Map<string, { ticks: number; time: number }>();
    let partial = false, truncated = evidence.length > MAX_PROCESSES;
    const stat = async (pid: number) => parseProcessStat((await this.read(`${pid}/stat`)).toString(), pid);
    const record = (value: ProcessStat, verified: boolean, attribution: ProcessAttribution, taskId: string | null, detail: string | null, parentPid: number | null = null): ObservedProcess => {
      const key = `${context.bootId}:${value.pid}:${value.startTicks}`, time = this.clock(), prior = this.previous.get(key);
      const delta = prior ? value.ticks - prior.ticks : -1;
      next.set(key, { ticks: value.ticks, time });
      return { id: key, pid: value.pid, ppid: value.ppid, parentPid, name: value.name, state: value.state,
        cpuPercent: verified && prior && time > prior.time && delta >= 0 ? delta / context.clockTicks / ((time - prior.time) / 1000) * 100 : null,
        rssBytes: value.rssPages * context.pageBytes, elapsedSeconds: context.uptime >= value.startTicks / context.clockTicks ? context.uptime - value.startTicks / context.clockTicks : null,
        attribution: verified ? attribution : 'unverified', identityVerified: verified, taskId, detail };
    };
    for (const candidate of evidence.slice(0, MAX_PROCESSES)) {
      if (this.clock() - started > 200) { truncated = true; break; }
      const { identity } = candidate;
      if (rows.get(identity.pid)?.identityVerified) continue;
      try {
        const value = await stat(identity.pid);
        const verified = identity.bootId === context.bootId && value.startTicks === identity.startTicks && !['Z', 'X', 'x'].includes(value.state);
        rows.set(value.pid, record(value, verified, candidate.attribution, candidate.taskId, verified ? null : 'Recorded boot/start identity does not match a live process.'));
        if (verified) stats.set(value.pid, value);
      } catch (error) {
        const missing = ['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '');
        if (!missing) partial = true;
        rows.set(identity.pid, { id: `unverified:${identity.pid}:${identity.startTicks}`, pid: identity.pid, ppid: null, parentPid: null,
          name: 'Unavailable', state: missing ? 'gone' : 'unknown', cpuPercent: null, rssBytes: null, elapsedSeconds: null,
          attribution: 'unverified', identityVerified: false, taskId: candidate.taskId, detail: missing ? 'Recorded process is no longer present.' : 'Process could not be read or validated.' });
      }
    }
    // Only follow known descendants, never scan every /proc entry or any environment.
    let frontier = [...stats.keys()];
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
      const following: number[] = [];
      for (const pid of frontier) {
        if (rows.size >= MAX_PROCESSES || this.clock() - started > 200) { truncated = true; break; }
        try {
          const parent = stats.get(pid)!;
          const text = (await this.read(`${pid}/task/${pid}/children`, 4096)).toString().trim();
          const children = text ? text.split(/\s+/) : [];
          if (children.length > MAX_PROCESSES) truncated = true;
          for (const child of children.slice(0, MAX_PROCESSES)) {
            if (this.clock() - started > 200) { truncated = true; break; }
            if (rows.size >= MAX_PROCESSES) { truncated = true; break; }
            if (!/^[1-9]\d*$/.test(child)) { partial = true; continue; }
            const childPid = Number(child);
            if (!Number.isSafeInteger(childPid) || rows.has(childPid)) continue;
            try {
              const value = await stat(childPid), parentAgain = await stat(pid);
              if (parentAgain.startTicks !== parent.startTicks || parentAgain.state === 'Z' || value.ppid !== pid || value.startTicks < parent.startTicks || ['Z', 'X', 'x'].includes(value.state)) { partial = true; continue; }
              const parentRow = rows.get(pid)!;
              rows.set(childPid, record(value, true, 'child', parentRow.taskId, 'Verified descendant of an identity-matched process.', pid));
              stats.set(childPid, value); following.push(childPid);
            } catch { partial = true; }
          }
        } catch (error) { if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) partial = true; }
      }
      frontier = following;
      if (depth === 3 && following.length) truncated = true;
    }
    // Directly recorded roots can also be linked, but only to another verified parent.
    for (const row of rows.values()) {
      const parent = row.ppid === null ? undefined : rows.get(row.ppid);
      if (row.identityVerified && parent?.identityVerified && stats.get(row.pid)!.startTicks >= stats.get(parent.pid)!.startTicks) row.parentPid = parent.pid;
    }
    this.previous = next;
    return { source: source(partial || truncated ? 'stale' : 'ok', observedAt, partial ? 'Partial process data: a process disappeared, changed identity, or was unreadable.' : truncated ? 'Process observation was capped by count, depth, or cycle budget.' : null, now), items: [...rows.values()], truncated };
  }
}
