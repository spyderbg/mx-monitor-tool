import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inject } from 'postject';
import { APP_ID } from '../shared/config.js';
import { bundleBackend } from './build.js';
import { run, validateRuntime } from './packaging.js';

validateRuntime(process.version, process.platform);
if (process.argv.length > 2) throw new Error('M0 packages only the current native Linux runtime; no cross targets.');
await mkdir('dist', { recursive: true });
await bundleBackend(true, 'build/sea-server.cjs');
const config = {
  main: resolve('build/sea-server.cjs'), output: resolve('build/sea-prep.blob'),
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false,
};
await writeFile('build/sea-config.json', JSON.stringify(config, null, 2));
await run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json']);
const executable = resolve('dist', APP_ID);
await copyFile(process.execPath, executable);
await inject(executable, 'NODE_SEA_BLOB', await readFile(config.output), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});
await chmod(executable, 0o755);
console.log(`Created ${executable} (${process.version}, linux-${process.arch}; STOP_ON_PAGE_CLOSE=true).`);
