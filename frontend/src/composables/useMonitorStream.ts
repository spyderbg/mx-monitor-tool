import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { MonitorSnapshot } from '../../../shared/api.js';
import { StreamState } from '../monitor-state.js';
import { useBackendLifetime } from './useBackendLifetime.js';

export function useMonitorStream() {
  const snapshot = ref<MonitorSnapshot | null>(null);
  const connection = ref<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const error = ref<string | null>(null), now = ref(Date.now());
  const state = new StreamState();
  let stream: EventSource | undefined, controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false, fetching = false, lastTransportAt = Date.now();
  async function refresh(): Promise<void> {
    if (fetching || disposed) return;
    fetching = true; controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 5_000);
    try {
      const response = await fetch('/api/snapshot', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Snapshot unavailable.');
      const value = state.fromHttp(await response.json());
      if (!disposed && value) { snapshot.value = value; error.value = null; }
    } catch { if (!disposed) error.value = 'Snapshot unavailable. Last received values may be stale.'; }
    finally { clearTimeout(timeout); fetching = false; }
  }
  const lifetime = useBackendLifetime(() => {
    if (disposed) return;
    stream?.close();
    stream = new EventSource('/api/stream');
    connection.value = snapshot.value ? 'reconnecting' : 'connecting';
    stream.addEventListener('snapshot', event => {
      try {
        const value = state.accept(JSON.parse((event as MessageEvent<string>).data) as unknown);
        if (!value) return;
        snapshot.value = value; connection.value = 'connected'; error.value = null; lastTransportAt = Date.now();
      } catch { error.value = 'An invalid monitoring update was ignored.'; }
    });
    stream.addEventListener('heartbeat', () => { lastTransportAt = Date.now(); connection.value = 'connected'; });
    // Native EventSource reconnects; the server always sends a complete initial snapshot.
    stream.onerror = () => { connection.value = 'reconnecting'; error.value = 'Live updates interrupted. Reconnecting…'; };
    void refresh();
  });
  const age = computed(() => snapshot.value ? Math.max(0, Math.floor((now.value - Date.parse(snapshot.value.observedAt)) / 1000)) : null);
  const connectionError = computed(() => lifetime.connectionError.value);
  onMounted(() => { timer = setInterval(() => { now.value = Date.now(); if (Date.now() - lastTransportAt > 20_000) connection.value = 'disconnected'; }, 1_000); });
  onUnmounted(() => { disposed = true; clearInterval(timer); controller?.abort(); stream?.close(); });
  return { snapshot, connection, connectionError, error, age, refresh };
}
