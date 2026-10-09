import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
rmSync(new URL('../../.test-dist/', import.meta.url), { recursive: true, force: true });

for (const args of [
  ['run', 'build'],
  ['./node_modules/typescript/bin/tsc', '--project', 'tsconfig.fixtures.json'],
]) {
  const result = Bun.spawnSync([process.execPath, ...args], {
    cwd: projectRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    timeout: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Compilation failed (${result.exitCode}): ${args.join(' ')}`);
  }
}
