import { onMounted, onUnmounted, ref } from 'vue';

export function useBackendLifetime(onConnected: () => void) {
  const connection = ref<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const error = ref<string | null>(null);
  let stream: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let bootstrap: AbortController | undefined;

  async function connect(): Promise<void> {
    stream?.close();
    bootstrap = new AbortController();
    const timeout = setTimeout(() => bootstrap?.abort(), 5_000);
    try {
      const response = await fetch('/api/session', { cache: 'no-store', signal: bootstrap.signal });
      if (!response.ok) throw new Error('Session unavailable.');
      if (disposed) return;
      error.value = null;
      stream = new EventSource('/api/lifecycle');
      stream.addEventListener('ready', () => {
        connection.value = 'connected'; error.value = null; onConnected();
      });
      stream.onerror = () => {
        connection.value = 'reconnecting';
        error.value = 'Connection lost. Reconnecting to the Monitor…';
        // Re-bootstrap so a restarted backend's new session is picked up.
        stream?.close();
        retry = setTimeout(() => { void connect(); }, 1_000);
      };
    } catch {
      if (disposed) return;
      connection.value = 'disconnected';
      error.value = 'Monitor unavailable. Retrying the local connection…';
      retry = setTimeout(() => { void connect(); }, 2_000);
    } finally { clearTimeout(timeout); }
  }
  onMounted(() => { void connect(); });
  onUnmounted(() => {
    disposed = true; clearTimeout(retry); bootstrap?.abort(); stream?.close();
  });
  return { connection, connectionError: error };
}
