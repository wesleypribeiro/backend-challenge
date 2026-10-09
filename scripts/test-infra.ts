import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const scope = args.length === 0 ? 'all' : args.length === 1 && args[0] === '--scope=p0' ? 'p0' :
  args.length === 1 && args[0] === '--scope=all' ? 'all' : undefined;
const report = (status: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({
  event: 'infrastructure.acceptance', scope, status, financialTests: 'pending', ...extra,
}));

if (!scope) {
  console.error('Usage: bun run test:infra [--scope=p0|--scope=all]');
  process.exit(2);
}

// Sem filtro nunca apresentar os cenários P0 como conformidade P0+P1.
// O manifesto de suites P1 deve acompanhar a implementação das tarefas 6–9.
const p1Files = Array.from(new Bun.Glob('tests/p1/**/*.test.ts').scanSync({ cwd: root }));
const tasks = await Bun.file(new URL('../openspec/changes/bootstrap-backend-foundation/tasks.md', import.meta.url)).text();
const pendingP1 = [...tasks.matchAll(/^- \[ \] ([6-9]\.\d+) /gm)].map((match) => match[1]!);
if (scope === 'all' && (p1Files.length === 0 || pendingP1.length > 0)) {
  report('incomplete', { missing: pendingP1.length ? pendingP1 : ['P1 suite manifest'], hint: 'Select --scope=p0 for the partial milestone; full acceptance requires P1 suites.' });
  process.exit(1);
}

report('running', { p1: scope === 'p0' ? 'not_executed' : 'included' });
for (const script of ['typecheck', 'build', 'test:unit', 'test:integration', 'test:smoke']) {
  console.log(`[infra:${scope}] bun run ${script}`);
  const child = Bun.spawn([process.execPath, 'run', script], {
    cwd: root, stdout: 'inherit', stderr: 'inherit', env: process.env,
  });
  const code = await child.exited;
  if (code !== 0) { report('failed', { script, exitCode: code }); process.exit(code || 1); }
}
if (scope === 'all') {
  const child = Bun.spawn([process.execPath, 'test', ...p1Files], { cwd: root, stdout: 'inherit', stderr: 'inherit', env: process.env });
  const code = await child.exited;
  if (code !== 0) { report('failed', { suite: 'p1', exitCode: code }); process.exit(code || 1); }
}
report('passed', { p1: scope === 'p0' ? 'pending' : 'executed' });
