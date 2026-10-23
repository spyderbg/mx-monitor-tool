import type { DataSection, SourceState, SourceStatus } from '../shared/api.js';

export function source(status: SourceState, observedAt: string | null, detail: string | null = null, now = Date.now(), live = false, lastSuccessfulAt = observedAt): SourceStatus {
  return { status, observedAt, lastSuccessfulAt, ageSeconds: observedAt ? Math.max(0, (now - Date.parse(observedAt)) / 1000) : null, liveIdentityVerified: live, detail };
}
export function emptySection<T>(detail: string): DataSection<T> {
  return { source: source('unavailable', null, detail), items: [], truncated: false };
}
