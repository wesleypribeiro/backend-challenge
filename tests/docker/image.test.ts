import { expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localEnvironment } from '../support/environment.js';
import { projectRoot } from '../support/process.js';

test('final Docker image boots compiled API and worker without sources or sensitive files', async () => {
  const context = process.env.DOCKER_CONTEXT;
  const prefix = context ? ['docker', '--context', context] : ['docker'];
  function docker(args: string[]) {
    const result = Bun.spawnSync([...prefix, ...args], {
      cwd: projectRoot, stdout: 'pipe', stderr: 'pipe', timeout: 300_000,
    });
    if (result.exitCode !== 0) throw new Error(`Docker failed: ${args[0]}\n${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  }
  // Ausência do daemon falha explicitamente; não converter em skip.
  docker(['info']);
  const id = crypto.randomUUID();
  const image = `jungle-foundation-smoke:${id}`;
  const contextImage = `jungle-foundation-context:${id}`;
  const directory = await mkdtemp(join(tmpdir(), 'jungle-docker-'));
  const containers: string[] = [];
  try {
    for (const path of ['Dockerfile', '.dockerignore', '.bun-version', 'package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'tsconfig.build.json', 'scripts', 'src', 'patches']) {
      await cp(join(projectRoot, path), join(directory, path), { recursive: true });
    }
    for (const path of ['.env', '.env.production', 'credentials.pem', 'src/.env', 'src/private.key']) {
      await writeFile(join(directory, path), 'sensitive-fixture-must-not-enter-image');
    }
    for (const path of ['node_modules', 'dist', '.test-dist', '.git', '.aws', 'secrets']) {
      await mkdir(join(directory, path));
      await writeFile(join(directory, path, 'sentinel'), 'excluded');
    }
    // Alvo temporário inspeciona o contexto real filtrado pelo Docker, sem alterar o Dockerfile versionado.
    const original = await Bun.file(join(directory, 'Dockerfile')).text();
    await writeFile(join(directory, 'Dockerfile'), `${original}\nFROM base AS context-check\nCOPY . /context\n`);
    docker(['build', '--target', 'context-check', '--tag', contextImage, directory]);
    const contextFiles = docker(['run', '--rm', '--network', 'none', contextImage, 'find', '/context', '-type', 'f']);
    for (const path of ['.env', '.env.production', 'credentials.pem', 'src/.env', 'src/private.key', 'node_modules/sentinel', 'dist/sentinel', '.test-dist/sentinel', '.git/sentinel', '.aws/sentinel', 'secrets/sentinel']) {
      expect(contextFiles.split('\n')).not.toContain(`/context/${path}`);
    }
    expect(contextFiles).toContain('/context/src/bootstrap/api.ts');
    docker(['build', '--target', 'runtime', '--tag', image, directory]);

    const inspection = JSON.parse(docker(['run', '--rm', '--network', 'none', image, '--eval', `
      import { existsSync, readdirSync } from 'node:fs';
      console.log(JSON.stringify({
        bun: process.versions.bun, uid: process.getuid(),
        forbidden: ['src','tests','scripts','.env','.env.production','.test-dist','bunfig.toml','node_modules/typescript'].filter(existsSync),
        dist: readdirSync('dist', { recursive: true })
      }));
    `]));
    expect(inspection.bun).toBe('1.4.2');
    expect(inspection.uid).not.toBe(0);
    expect(inspection.forbidden).toEqual([]);
    expect(inspection.dist.every((path: string) => !path.endsWith('.ts') && !path.endsWith('.map'))).toBe(true);

    const environment = Object.entries({ ...localEnvironment, NODE_ENV: 'production', API_PORT: '3000' }).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    const start = (role: 'api' | 'worker') => {
      const container = docker(['run', '--detach', '--network', 'none', ...environment, image, `dist/bootstrap/${role}.js`]);
      containers.push(container);
      return container;
    };
    const api = start('api');
    const worker = start('worker');
    for (const container of [api, worker]) {
      const expected = '"event":"process.started"';
      const deadline = Date.now() + 10_000;
      while (!docker(['logs', container]).includes(expected) && Date.now() < deadline) await Bun.sleep(100);
      expect(docker(['logs', container])).toContain(expected);
      const logs = docker(['logs', container]).split('\n').map((line) => JSON.parse(line));
      expect(logs.some((line) => line.runtime === 'bun:1.4.2')).toBe(true);
    }
    const response = JSON.parse(docker(['exec', api, 'bun', '--eval', "const r = await fetch('http://127.0.0.1:3000/unimplemented', {headers:{'x-correlation-id':'docker-smoke'}}); console.log(JSON.stringify({status:r.status,id:r.headers.get('x-correlation-id')}));"]));
    expect(response).toEqual({ status: 404, id: 'docker-smoke' });
    docker(['stop', '--time', '5', api]);
    expect(docker(['inspect', '--format', '{{.State.Running}}', worker])).toBe('true');
    docker(['stop', '--time', '5', worker]);
  } finally {
    for (const container of containers) docker(['rm', '--force', container]);
    Bun.spawnSync([...prefix, 'image', 'rm', '--force', image, contextImage], { stdout: 'ignore', stderr: 'ignore' });
    await rm(directory, { recursive: true, force: true });
  }
}, 900_000);
