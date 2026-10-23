import { createServer } from 'vite';

const vite = await createServer();
await vite.listen();
process.send?.({ ready: true });
