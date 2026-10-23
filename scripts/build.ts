import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export async function bundleBackend(stopOnPageClose = false, outfile = 'build/server.cjs'): Promise<void> {
  await esbuild({
    entryPoints: ['backend/main.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { __STOP_ON_PAGE_CLOSE__: JSON.stringify(stopOnPageClose ? 'true' : 'false') },
    plugins: [{ name: 'embedded-frontend', setup(build) {
      build.onResolve({ filter: /(?:^|\/)embedded\.js$/ }, () => ({ path: resolve('build/embedded.ts') }));
    } }],
  });
}

async function build(): Promise<void> {
  await viteBuild();
  const root = resolve('build/frontend');
  const assets: Record<string, { mime: string; base64: string }> = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) assets[`/${relative(root, path).replaceAll('\\', '/')}`] = {
        mime: mime[extname(path)] ?? 'application/octet-stream', base64: (await readFile(path)).toString('base64'),
      };
    }
  }
  await walk(root);
  await mkdir('build', { recursive: true });
  await writeFile('build/embedded.ts', `export const assets = ${JSON.stringify(assets)};\n`);
  await bundleBackend();
}

// Importing the bundler for SEA packaging must not repeat the frontend build.
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/build.ts')) await build();
