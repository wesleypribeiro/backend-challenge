import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });

const compiler = Bun.spawn(
  [process.execPath, './node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json'],
  { cwd: projectRoot, stdout: 'inherit', stderr: 'inherit' },
);

process.exitCode = await compiler.exited;
