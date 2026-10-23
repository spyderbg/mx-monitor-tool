import { open } from 'node:fs/promises';
import { availableParallelism, hostname, platform, release, type } from 'node:os';
import type { MachineMetrics } from '../../shared/api.js';

interface CpuSample { total: number; idle: number }
const MAX_PROC_BYTES = 64 * 1024;

async function readProc(name: 'stat' | 'meminfo' | 'loadavg' | 'uptime'): Promise<string> {
  const file = await open(`/proc/${name}`, 'r');
  try {
    const buffer = Buffer.alloc(MAX_PROC_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_PROC_BYTES) throw new Error('Source exceeds limit.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

export function parseCpu(text: string): CpuSample {
  const line = text.split('\n')[0];
  if (!line?.startsWith('cpu ')) throw new Error('CPU source invalid.');
  // guest/guest_nice are already included in user/nice; count only first 8 fields.
  const fields = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (fields.length < 4 || fields.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('CPU source invalid.');
  }
  return { total: fields.reduce((sum, value) => sum + value, 0), idle: fields[3]! + (fields[4] ?? 0) };
}

export function cpuPercent(previous: CpuSample | undefined, current: CpuSample): number | null {
  if (!previous) return null;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  if (total <= 0 || idle < 0 || idle > total) return null;
  return (total - idle) / total * 100;
}

export function parseMemory(text: string): Pick<MachineMetrics, 'memory' | 'swap'> {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB\s*$/.exec(line);
    if (match) values.set(match[1]!, Number(match[2]) * 1024);
  }
  const total = values.get('MemTotal'), available = values.get('MemAvailable');
  const swapTotal = values.get('SwapTotal'), swapFree = values.get('SwapFree');
  if ([total, available, swapTotal, swapFree].some(value => value === undefined || !Number.isSafeInteger(value))) {
    throw new Error('Memory source invalid.');
  }
  if (available! > total! || swapFree! > swapTotal! || total! <= 0) throw new Error('Memory source invalid.');
  return {
    memory: { totalBytes: total!, availableBytes: available!, usedBytes: total! - available! },
    swap: { totalBytes: swapTotal!, usedBytes: swapTotal! - swapFree! },
  };
}

export class MachineCollector {
  private previous: CpuSample | undefined;
  private lastSuccessfulAt: string | null = null;

  constructor(private readonly read = readProc, private readonly hostPlatform = platform()) {}

  async collect(): Promise<MachineMetrics> {
    const base: MachineMetrics = {
      source: { status: 'unavailable', observedAt: null, lastSuccessfulAt: this.lastSuccessfulAt, detail: null },
      hostname: hostname(), os: `${type()} ${release()}`, logicalCpus: availableParallelism(),
      cpuPercent: null, loadAverage: null, uptimeSeconds: null, memory: null, swap: null,
    };
    if (this.hostPlatform !== 'linux') {
      base.source.status = 'unsupported';
      base.source.detail = 'Machine collection requires Linux.';
      return base;
    }
    try {
      const [stat, memory, load, uptime] = await Promise.all([
        this.read('stat'), this.read('meminfo'), this.read('loadavg'), this.read('uptime'),
      ]);
      const current = parseCpu(stat);
      const averages = load.trim().split(/\s+/).slice(0, 3).map(Number);
      const uptimeValue = uptime.trim().split(/\s+/)[0] ?? '';
      if (!/^\d+(\.\d+)?$/.test(uptimeValue)) throw new Error('Uptime source invalid.');
      const seconds = Number(uptimeValue);
      if (averages.length !== 3 || averages.some(value => !Number.isFinite(value) || value < 0) ||
          !Number.isFinite(seconds) || seconds < 0) throw new Error('Machine source invalid.');
      const parsedMemory = parseMemory(memory);
      const cpu = cpuPercent(this.previous, current);
      this.previous = current;
      this.lastSuccessfulAt = new Date().toISOString();
      return { ...base, ...parsedMemory, cpuPercent: cpu, loadAverage: averages as [number, number, number], uptimeSeconds: seconds,
        source: { status: 'ok', observedAt: this.lastSuccessfulAt, lastSuccessfulAt: this.lastSuccessfulAt, detail: null } };
    } catch {
      this.previous = undefined;
      base.source.status = 'error';
      base.source.detail = 'Machine data unavailable: a Linux source could not be read or validated.';
      return base;
    }
  }
}
