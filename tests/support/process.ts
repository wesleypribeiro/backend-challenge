import { fileURLToPath } from 'node:url';
import { testProcessEnvironment } from './environment.js';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function runBun(args: string[], cwd = projectRoot) {
  const result = Bun.spawnSync([process.execPath, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15_000,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export function startService(entrypoint: string, overrides: Record<string, string | undefined> = {}, extraArgs: string[] = []) {
  const processHandle = Bun.spawn([process.execPath, '--no-env-file', entrypoint, ...extraArgs], {
    cwd: projectRoot,
    env: testProcessEnvironment(overrides),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = { stdout: '', stderr: '' };

  async function drain(stream: ReadableStream<Uint8Array>, channel: keyof typeof output) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        output[channel] += decoder.decode(result.value, { stream: true });
      }
      output[channel] += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  const drained = Promise.all([
    drain(processHandle.stdout, 'stdout'),
    drain(processHandle.stderr, 'stderr'),
  ]);

  return {
    process: processHandle,
    output,
    async waitFor(pattern: RegExp): Promise<RegExpMatchArray> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const match = output.stdout.match(pattern);
        if (match) return match;
        if (processHandle.exitCode !== null) break;
        await Bun.sleep(10);
      }
      throw new Error(`Process did not become available: ${entrypoint}\n${output.stdout}\n${output.stderr}`);
    },
    async stop(): Promise<void> {
      if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
      const forceStop = setTimeout(() => processHandle.kill('SIGKILL'), 3_000);
      try {
        await processHandle.exited;
        await drained;
      } finally {
        clearTimeout(forceStop);
      }
    },
  };
}
