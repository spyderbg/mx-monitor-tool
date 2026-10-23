import { DEFAULT_BACKEND_PORT, DEFAULT_VITE_DEV_PORT } from '../shared/config.js';
import { createServer } from './server.js';
import { openBrowser } from './platform.js';
import { existingInstance, runtimeOptions } from './runtime.js';

declare const __STOP_ON_PAGE_CLOSE__: 'true' | 'false' | undefined;
const STOP_ON_PAGE_CLOSE = typeof __STOP_ON_PAGE_CLOSE__ === 'undefined' ? 'false' : __STOP_ON_PAGE_CLOSE__;

async function main(): Promise<void> {
  const options = runtimeOptions();
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void app.close().catch(() => { process.exitCode = 1; });
  };
  const app = await createServer({ dev: options.dev, sampleMs: options.sampleMs, taskSampleMs: options.taskSampleMs, staleMs: options.staleMs,
    ...(options.workerStateDir ? { workerStateDir: options.workerStateDir } : {}),
    ...(STOP_ON_PAGE_CLOSE === 'true' ? { onShutdown: shutdown } : {}),
  });
  app.addHook('onClose', async () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  });
  try { await app.listen({ host: options.host, port: options.port }); }
  catch (error) {
    await app.close();
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    const existing = await existingInstance(options.port);
    if (!existing) throw new Error('Port in use by another application. Choose a different PORT.');
    const openPort = existing.dev ? options.port + DEFAULT_VITE_DEV_PORT - DEFAULT_BACKEND_PORT : options.port;
    const url = `http://127.0.0.1:${openPort}`;
    console.log(`Existing Monitor instance: ${url}`);
    if (!options.noOpen) await openBrowser(url);
    return;
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.log(`Monitor ready: ${options.openUrl}`);
  if (!options.noOpen) {
    try { await openBrowser(options.openUrl); }
    catch { console.error('Browser could not be opened. Open the displayed local URL manually.'); }
  }
}

void main().catch((error: unknown) => {
  // Only our validation messages are safe to print; never dump paths or raw OS errors.
  const message = error instanceof Error ? error.message : '';
  console.error(/^(PORT|HOST|OPEN_URL|Port in use|Unknown argument|--worker-state-dir|Worker state directory|Monitoring interval)/.test(message) ? message : 'Monitor startup failed. Check the local runtime and configuration.');
  process.exitCode = 1;
});
