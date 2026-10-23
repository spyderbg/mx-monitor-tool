import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, opendir, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { id, parseBoundedJson } from './validation.js';

export type RecordKind = 'features' | 'tasks' | 'claims' | 'checkpoints' | 'scheduling' | 'service';
const KINDS: readonly string[] = ['features', 'tasks', 'claims', 'checkpoints', 'scheduling', 'service'];
export const MAX_RECORD_BYTES = 256 * 1024;
export class ReadFailure extends Error {
  constructor(readonly kind: 'missing' | 'unsafe' | 'limit' | 'unreadable') { super(`Worker source ${kind}.`); }
}
function failure(error: unknown): ReadFailure {
  if (error instanceof ReadFailure) return error;
  const code = (error as NodeJS.ErrnoException).code;
  return new ReadFailure(code === 'ENOENT' ? 'missing' : code === 'ELOOP' || code === 'ENOTDIR' ? 'unsafe' : 'unreadable');
}

/** Linux FD-anchored traversal: every untrusted component is opened NOFOLLOW.
 * Holding directory FDs prevents parent-directory rename/symlink TOCTOU escapes.
 * /proc/self/fd is used only for this process's own already-open directory handles. */
export class WorkerFiles {
  readonly deadline: number;
  private constructor(private readonly root: FileHandle, readonly identity: string, budgetMs: number) { this.deadline = performance.now() + budgetMs; }
  static async open(root: string, budgetMs = 500): Promise<WorkerFiles> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(resolve(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      return new WorkerFiles(handle, `${info.dev}:${info.ino}`, budgetMs);
    } catch (error) { await handle?.close(); throw failure(error); }
  }
  checkBudget(): void { if (performance.now() > this.deadline) throw new ReadFailure('limit'); }
  async close(): Promise<void> { await this.root.close(); }
  private async directory(kind: RecordKind): Promise<FileHandle> {
    this.checkBudget();
    if (!KINDS.includes(kind)) throw new ReadFailure('unsafe');
    try { return await open(`/proc/self/fd/${this.root.fd}/${kind}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { throw failure(error); }
  }
  async names(kind: RecordKind, maximum: number): Promise<{ ids: string[]; truncated: boolean }> {
    const handle = await this.directory(kind);
    try {
      const directory = await opendir(`/proc/self/fd/${handle.fd}`);
      const found: string[] = [];
      let scanned = 0, truncated = false;
      try {
        for await (const entry of directory) {
          this.checkBudget();
          if (++scanned > maximum * 2) { truncated = true; break; }
          if (!entry.name.endsWith('.json')) continue;
          try { id(entry.name.slice(0, -5)); } catch { continue; }
          if (found.length >= maximum) { truncated = true; break; }
          found.push(entry.name.slice(0, -5)); // Symlinks/non-files are refused when opened.
        }
      } finally { await directory.close().catch(() => {}); }
      return { ids: found.sort(), truncated };
    } catch (error) { throw failure(error); }
    finally { await handle.close(); }
  }
  private async file(kind: RecordKind | null, name: string): Promise<FileHandle> {
    this.checkBudget();
    if (kind === null && name !== 'events.jsonl') throw new ReadFailure('unsafe');
    if (kind !== null && (kind === 'service' ? name !== 'worker.json' : !/^[a-z0-9][a-z0-9._-]{0,79}\.json$/.test(name))) throw new ReadFailure('unsafe');
    const directory = kind === null ? this.root : await this.directory(kind);
    let handle: FileHandle | undefined;
    try {
      handle = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new ReadFailure('unsafe');
      return handle;
    } catch (error) { await handle?.close(); throw failure(error); }
    finally { if (directory !== this.root) await directory.close(); }
  }
  private async bytes(kind: RecordKind, recordId: string): Promise<Buffer> {
    id(recordId);
    const handle = await this.file(kind, `${recordId}.json`);
    try {
      if ((await handle.stat()).size > MAX_RECORD_BYTES) throw new ReadFailure('limit');
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
        this.checkBudget();
      }
      if (total > MAX_RECORD_BYTES) throw new ReadFailure('limit');
      return buffer.subarray(0, total);
    } catch (error) { if (error instanceof SyntaxError) throw new ReadFailure('unreadable'); throw error; }
    finally { await handle.close(); }
  }
  async json(kind: RecordKind, recordId: string): Promise<unknown> { return parseBoundedJson((await this.bytes(kind, recordId)).toString('utf8')); }
  async digest(kind: RecordKind, recordId: string): Promise<string> { return createHash('sha256').update(await this.bytes(kind, recordId)).digest('hex'); }
  async eventFile(): Promise<FileHandle> { return this.file(null, 'events.jsonl'); }
}
