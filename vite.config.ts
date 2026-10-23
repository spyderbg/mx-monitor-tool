import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { DEFAULT_BACKEND_PORT, DEFAULT_VITE_DEV_PORT, parsePort } from './shared/config.js';

const devPort = process.env.PORT === undefined ? DEFAULT_VITE_DEV_PORT : parsePort(process.env.PORT) + 1;

export default defineConfig({
  root: 'frontend',
  plugins: [vue()],
  server: {
    host: '127.0.0.1', port: devPort,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
      // Vite HMR inserts styles and uses a local WebSocket; production allows neither exception.
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${devPort}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT === undefined ? DEFAULT_BACKEND_PORT : parsePort(process.env.PORT)}`, changeOrigin: false } },
  },
  build: { outDir: '../build/frontend', emptyOutDir: true },
});
