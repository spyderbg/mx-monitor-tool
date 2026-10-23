import { spawn } from 'node:child_process';

export function validateRuntime(version: string, platform: string): void {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node >=22.12 is required.');
  if (platform !== 'linux') throw new Error('M0 SEA packaging supports native Linux only.');
}

export async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Build command failed (${code}).`)));
  });
}
