import { expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, symlink, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { projectRoot, runBun } from '../support/process.js';

test('pinned dependencies import under Bun and satisfy required peers', async () => {
  const manifest = await Bun.file(join(projectRoot, 'package.json')).json();
  expect(Bun.version).toBe(await readFile(join(projectRoot, '.bun-version'), 'utf8').then((v) => v.trim()));
  const rootRequire = createRequire(join(projectRoot, 'package.json'));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const packagePath = rootRequire.resolve(`${name}/package.json`);
    const dependency = await Bun.file(packagePath).json();
    const requiredPeers: Record<string, string> = dependency.peerDependencies ?? {};
    for (const [peer, range] of Object.entries(requiredPeers)) {
      const peerRequire = createRequire(packagePath);
      let peerPath: string;
      try {
        peerPath = peerRequire.resolve(`${peer}/package.json`);
      } catch (error) {
        if (dependency.peerDependenciesMeta?.[peer]?.optional) continue;
        throw error;
      }
      const installed = await Bun.file(peerPath).json();
      expect(Bun.semver.satisfies(installed.version, range)).toBe(true);
    }
  }
  for (const name of Object.keys(manifest.dependencies)) {
    expect(await import(name)).toBeDefined();
  }
});

test('typecheck rejects a real strict typing violation with nonzero exit code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jungle-type-error-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'invalid.ts'), 'export const value: string = 123;\n');
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      extends: join(projectRoot, 'tsconfig.json'),
      compilerOptions: { types: [] },
      include: [join(directory, 'invalid.ts')],
    }));
    const result = runBun(['run', 'typecheck', '--project', join(directory, 'tsconfig.json')]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('TS2322');
    expect(result.stdout).not.toContain('TS1295');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('build propagates compiler errors and does not emit invalid JavaScript', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jungle-build-error-'));
  try {
    for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
      await cp(join(projectRoot, file), join(directory, file));
    }
    await cp(join(projectRoot, 'scripts'), join(directory, 'scripts'), { recursive: true });
    await symlink(join(projectRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src/invalid.ts'), 'export const value: string = 123;\n');
    const result = runBun(['run', 'build'], directory);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('TS2322');
    expect(await access(join(directory, 'dist/invalid.js')).then(() => true, () => false)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
