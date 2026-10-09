# Evidências de implementação — lote P0 1.1–1.4

Escopo autorizado: toolchain, TypeScript/build ESM, bootstrap NestJS independente e testes técnicos com Bun Test. Somente 4 das 34 tarefas foram concluídas. Esta evidência não conclui P0 nem a change e não comprova garantias financeiras.

## Versões fixadas

Todas as dependências diretas usam versões exatas em `package.json`; transitivas estão em `bun.lock`. Bun está fixado em `.bun-version`, `packageManager` e `engines`.

| Componente | Versão |
|---|---|
| Bun | 1.4.2 (`744846f84`) |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | 12.1.2 |
| `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/migrations` | 7.2.4 |
| `@mikro-orm/nestjs` | 7.1.0 |
| `pg` | 8.23.1 |
| `@aws-sdk/client-sqs` | 3.1148.0 |
| `reflect-metadata` | 0.2.2 |
| `rxjs` | 7.8.2 |
| `typescript` | 5.9.3 |
| `@types/bun` | 1.4.2 |
| `@types/pg` | 8.23.1 |

Bun não estava instalado no ambiente inicial. Foi instalado em `~/.bun/bin/bun` a partir do [release oficial 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2), sem alterar perfis do shell. O arquivo `bun-linux-x64.zip` teve SHA-256 conferido contra o digest publicado pelo GitHub: `36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913`. Para reproduzir os comandos neste ambiente, incluir `~/.bun/bin` no `PATH`.

## Decisões e limites

- TypeScript 5.9.3 mantém o compilador JavaScript executável sob Bun e a emissão explícita de legacy decorators/metadata exigida pelo NestJS. A versão foi validada com os pacotes escolhidos; não se presume incompatibilidade de versões posteriores. MikroORM 7 usa ESM e requer TypeScript 5.8 ou superior; `NodeNext` está alinhado a essa escolha. [MikroORM: atualização para v7](https://mikro-orm.io/docs/upgrading-v6-to-v7)
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmitOnError` e verificação de tipos das bibliotecas estão habilitados. `build` limpa apenas `dist/`, executa `tsc` com Bun e propaga seu exit code. Não há bundler ou runner adicional.
- Os entrypoints carregam `reflect-metadata` antes de importar a composição. API usa o adapter Express padrão; worker usa `createApplicationContext`, sem listener HTTP. `WorkerLifetime` mantém um timer ocioso enquanto não existem consumers e o libera pelo lifecycle NestJS; não agenda trabalho nem acessa filas. Hooks básicos de sinais permitem encerramento, mas draining/deadline e diagnóstico de shutdown pertencem a 5.3/8.2.
- A API deste lote não registra rotas: o smoke espera HTTP 404 em uma URL inexistente. `API_PORT` permite porta efêmera nos testes. Validação completa de configuração, logs JSON e health permanecem em 2.1, 2.2 e 5.1.
- Bun Test compila aplicação e fixtures antes da suite. DI usa classes técnicas apenas em `tests/fixtures/`: a dependência atravessa módulos NestJS e é chamada de fato. O teste negativo executa outro Bun Test com uma dependência não registrada e exige que esse runner falhe. O teste de import remove um arquivo JavaScript em uma cópia temporária do build sem fontes TypeScript.
- As dependências PostgreSQL/SQS foram instaladas e importadas, sem inicializar clientes, bancos, filas ou migrations. A compatibilidade de integração só será comprovada nos lotes correspondentes. Não há entidades financeiras, ORM alternativo, Jest ou abstrações de domínio vazias.

## Comandos e resultados observados

| Comando/verificação | Resultado |
|---|---|
| `bun --version` | `1.4.2` |
| `bun install` | Sucesso; 150 packages instalados e `bun.lock` gerado |
| `bun pm ls` | Dependências instaladas nas versões fixadas |
| `bun pm untrusted` | Nenhum lifecycle script não confiável pendente |
| `bun install --frozen-lockfile` | Sucesso no workspace e em diretório temporário inicialmente vazio, sem mudança do lockfile |
| Verificação de peer dependencies | 14 restrições presentes/obrigatórias satisfeitas, incluindo peers opcionais instalados |
| Import de todas as dependências diretas de runtime com Bun | Sucesso; sem conectar serviços externos |
| `bun run typecheck` | Exit code 0; inclui fontes, scripts e testes |
| `bun run build` | Exit code 0; emite ESM em `dist/` |
| `bun test` | **7 pass, 0 fail, 43 asserções**, dois arquivos; execução observada de 10,57 s |
| `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive --json` | OpenSpec 1.13.1: change válida, zero issues, exit code 0 |
| `openspec instructions apply --change bootstrap-backend-foundation --json` | 4 tarefas concluídas, 30 pendentes; estado `ready` para próximos lotes |

`bun run test` e `bun run test:smoke` expõem o mesmo runner `bun test`. Os scripts `start:api` e `start:worker` executam os entrypoints JavaScript; o smoke inicia esses mesmos arquivos diretamente como processos Bun independentes. Nenhuma execução da aplicação depende de Node ou de fontes TypeScript no runtime.

A instalação limpa copiou somente `package.json`, `bun.lock`, `bunfig.toml` e `.bun-version` para um diretório temporário sem `node_modules`, executou `bun install --frozen-lockfile` e comparou SHA-256 antes/depois. O diretório temporário foi removido após a verificação. Hash preservado no workspace e na cópia: `595a56ecac95ef9025d994e7aedc18ffa26fd92cf1692fec87e2e8e35beb4f66`.

## Testes executados

| Teste | Evidência |
|---|---|
| Decorators, metadata e DI entre módulos compilados | `design:paramtypes` contém a classe esperada; Nest resolve o construtor; a chamada retorna versão Bun e valor esperado |
| DI deliberadamente inválida | Runner filho registra `1 fail`, identifica `RuntimeDependency` e retorna código não zero; a suite principal exige essa falha |
| Import compilado ausente | Bootstrap do worker termina com código não zero e identifica `worker-lifetime.js`; não existe `src/` na cópia |
| Independência de API e worker | Processos reais iniciam; parar API preserva worker; parar worker preserva uma nova API atendendo HTTP |
| Compatibilidade da toolchain | Versão Bun corresponde a `.bun-version`, peers são compatíveis e imports de runtime carregam |
| Erro real de tipagem | Script `typecheck` em fixture inválida retorna código não zero e diagnóstico `TS2322` |
| Erro real no build | Script `build` em projeto temporário inválido propaga diagnóstico `TS2322`, retorna código não zero e não emite JavaScript inválido |

Não houve testes inesperadamente reprovados na execução final. As falhas de DI/import/tipagem são estímulos controlados que a suite exige para passar. Na preparação da fixture externa de typecheck, foi acrescentado `package.json` com `type: module` para evitar diagnóstico incidental `TS1295`; o teste verifica a violação de tipo pretendida. Nenhuma incompatibilidade entre as versões instaladas foi encontrada nos cenários deste lote.

## Arquivos e continuidade

Arquivos de implementação criados:

```text
.bun-version
bun.lock
bunfig.toml
package.json
tsconfig.json
tsconfig.build.json
tsconfig.fixtures.json
scripts/build.ts
src/bootstrap/{api,worker}.ts
src/composition/{api.module,worker.module,worker-lifetime}.ts
tests/fixtures/{dependency.module,consumer.module,di-probe}.ts
tests/support/{compile,process}.ts
tests/smoke/{bootstrap,toolchain}.test.ts
```

Artefatos OpenSpec atualizados: `tasks.md` com evidências e marcação apenas de 1.1–1.4; `design.md` com versões e execução de D2; este registro novo. Proposal e as seis specs foram preservados. `node_modules/`, `dist/` e `.test-dist/` são saídas locais geradas, não fontes para versionamento. `.gitignore`/`.dockerignore` continuam na tarefa 2.1; nenhum commit, push ou PR faz parte deste lote.

Próximo lote recomendado: **2.1 → 1.5 → 2.2**, para preparar configuração/arquivos de exclusão antes da imagem final e depois logs estruturados. Continuar então com 2.3–2.5 (Compose, papéis PostgreSQL e harness). Essa ordem respeita a dependência do contexto Docker em relação a 2.1 sem ampliar o escopo desta execução. Health, migrations e testes com PostgreSQL/LocalStack reais permanecem pendentes.
