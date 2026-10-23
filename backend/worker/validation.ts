export class InvalidRecord extends Error {
  constructor(readonly unsupported = false) { super(unsupported ? 'Unsupported Worker record format.' : 'Worker record is incomplete or malformed.'); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidRecord();
  return value as Record<string, unknown>;
}
export function schema(value: unknown, versions: number[], fields?: readonly string[]): Record<string, unknown> {
  const record = object(value);
  if (!versions.includes(record.schema_version as number)) throw new InvalidRecord(true);
  if (fields && Object.keys(record).some(key => !fields.includes(key))) throw new InvalidRecord(true);
  return record;
}
export function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new InvalidRecord();
  return value;
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value) || /^(sk-|ghp_|github_pat_)/.test(value)) throw new InvalidRecord();
  return value;
}
export function label(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._/-]{0,79}$/.test(value) && !/(token|secret|password|sk-|ghp_|github_pat_)/i.test(value) && !/[A-Za-z0-9_+=]{28,}/.test(value) ? value : null;
}
export function stamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function list(value: unknown, maximum = 256): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new InvalidRecord();
  return value;
}
export function ids(value: unknown, maximum = 128): string[] { return list(value, maximum).map(id); }
export function member<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new InvalidRecord(true);
  return value as T;
}
export const roles = ['backend', 'cli', 'frontend', 'automation', 'coordination'] as const;
export function sha(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 12) : null;
}

export function safeText(value: unknown, maximum = 180): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/prompt|transcript|private.key|command.line|environment/i.test(value)) return 'Sensitive detail withheld.';
  return value.slice(0, 4096)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\b(?:authorization|api[_-]?key|token|secret|password|credential|cookie)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[redacted]')
    .replace(/\bBearer\s+\S+|\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[A-Z0-9]+|eyJ[\w.-]+)/g, '[redacted]')
    .replace(/https?:\/\/\S+|(?:^|\s)(?:\/[^\s,;]+|[A-Z]:\\[^\s,;]+)/g, ' [path withheld]')
    .replace(/[A-Za-z0-9_+=-]{28,}/g, '[redacted]')
    .replace(/<[^>]*>/g, '[markup]')
    .slice(0, maximum).trim() || null;
}

export function parseBoundedJson(text: string): unknown {
  let depth = 0, quoted = false, escape = false;
  for (const character of text) {
    if (quoted) {
      if (escape) escape = false;
      else if (character === '\\') escape = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > 16) throw new InvalidRecord(); }
    else if (character === '}' || character === ']') depth--;
  }
  try { return JSON.parse(text) as unknown; } catch { throw new InvalidRecord(); }
}
