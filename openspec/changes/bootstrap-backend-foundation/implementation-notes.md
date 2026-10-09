# Evidências de implementação — bootstrap-backend-foundation

Estado atual: **7/34 tarefas concluídas** — 1.1–1.5, 2.1 e 2.2. Esta evidência não conclui P0 nem a change e não comprova garantias financeiras.

As seções seguintes registram o primeiro lote, que concluiu 1.1–1.4. O segundo lote e suas evidências estão ao final deste documento; os registros históricos abaixo não substituem o estado atual.

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

Ao término do primeiro lote, a sequência recomendada foi **2.1 → 1.5 → 2.2**, para preparar configuração/arquivos de exclusão antes da imagem final e depois logs estruturados. Essa sequência foi executada no lote abaixo.

## Segundo lote — Git, 2.1 → 1.5 → 2.2

Implementado na branch `develop`, preservando 1.1–1.4 e sem alterar dependências ou `bun.lock`. Os entrypoints e testes existentes receberam apenas a integração da configuração/logging deste lote. Não foram implementados Compose, clientes PostgreSQL/SQS, migrations, health, consumers ou domínio financeiro. Nenhum commit, push ou PR foi criado.

### Correção de versionamento

`.test-dist/` passou a ser ignorada. `git rm -r --cached .test-dist` removeu do índice `consumer.module.js`, `dependency.module.js` e `di-probe.js`, mantendo arquivos locais; a suite continua regenerando suas próprias fixtures. Essa é a única alteração preparada no índice nesta execução.

`git check-ignore` comprovou exclusão de `dist/`, `node_modules/`, `.test-dist/`, `.env`, `.env.production`, `.env.local`, `.aws/credentials`, `secrets/`, chaves, logs e coverage. `git ls-files` confirmou ausência dos diretórios gerados e caminhos sensíveis verificados no índice. A exceção para exemplos foi restringida a `.env.example`, que contém apenas credenciais fictícias e pode ser versionada.

### Configuração por papel — 2.1

`loadConfiguration` valida antes do bootstrap NestJS e retorna configuração imutável, sem estabelecer conexões. Erros citam apenas nomes de variáveis e terminam o processo com exit code 1.

| Papel | Variáveis obrigatórias além de `NODE_ENV` | Exclusões |
|---|---|---|
| `api` | `DATABASE_URL`, endpoint/região/credenciais SQS e nomes das duas filas | Recusa `MIGRATION_DATABASE_URL`; valida `API_PORT` |
| `worker` | Mesmas dependências da API | Recusa credencial migrator; ignora porta HTTP |
| `migrator` | `MIGRATION_DATABASE_URL` | Não exige HTTP nem SQS; não recebe URL da aplicação na configuração retornada |
| `provision` | Endpoint/região/credenciais SQS e nomes das filas | Não exige PostgreSQL/HTTP; recusa credencial migrator |

Os papéis migrator/provision têm somente validação de configuração neste lote; seus comandos e operações continuam pendentes.

- `NODE_ENV` aceita `development`, `test` e `production`; não seleciona AWS real. O transporte desta fundação é exclusivamente local. Endpoint explícito HTTP(S) aceita `localhost`, `127.0.0.1`, `[::1]`, `localstack` ou `host.docker.internal`, sem userinfo, query, fragmento ou caminho adicional. Região é `us-east-1`, credenciais são exatamente `test`/`test`; session token é recusado. `AWS_PROFILE` e endpoints alternativos não substituem os campos explícitos retornados. Outros nomes de emulador exigirão uma alteração deliberada dessa lista.
- URLs PostgreSQL exigem usuário `wagering_app` ou `wagering_migrator`, conforme o papel, senha, host e database. Isso valida configuração; comprovar privilégios reais continua em 2.4/3.4.
- `API_PORT` tem default 3000, intervalo 1–65535, permitindo 0 apenas em testes. Filas exigem nomes FIFO distintos, com até 80 caracteres.
- Defaults e limites: `PG_POOL_MAX=5` (1–20), `PG_CONNECT_TIMEOUT_MS=1000` (1–10000), `PG_QUERY_TIMEOUT_MS=1000` (1–30000), `SHUTDOWN_TIMEOUT_MS=25000` (1–25000), `SQS_REQUEST_TIMEOUT_MS=25000` (21000–60000, maior que o long poll de 20 s), `SQS_MAX_ATTEMPTS=3` (1–5). Os valores são validados agora; sua aplicação aos clientes/draining ocorrerá nas respectivas tarefas, sem antecipar a implementação.
- `.env.example` documenta variáveis e diferenças host/container, mantendo a URL migrator comentada para não fornecê-la acidentalmente à API/worker. Os processos de teste usam ambiente controlado e `--no-env-file`.

### Imagem compilada — 1.5

Dockerfile multi-stage usa `oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895`, digest do índice OCI consultado no registry. Instalação congelada separa dependências de build e produção. O build confere a versão contra `.bun-version`, roda o compilador existente e remove source maps da imagem.

A imagem final contém `dist/`, dependências de produção e `package.json`, com usuário `bun` não root. `ENTRYPOINT ["bun", "--no-env-file"]` executa diretamente o JavaScript, por padrão `dist/bootstrap/api.js`; substituir o comando por `dist/bootstrap/worker.js` inicia o worker. Sem bind mounts, TypeScript original, compilador ou ferramentas de teste. Bun e Docker documentam os mecanismos utilizados: [Bun com Docker](https://bun.com/guides/ecosystem/docker), [contexto e dockerignore](https://docs.docker.com/build/concepts/context/).

`.dockerignore` permite somente os inputs necessários ao build e exclui novamente segredos sob `src/`. O teste copia o projeto para um contexto temporário, adiciona sentinelas `.env`, chaves e diretórios gerados, e inspeciona um estágio temporário com `COPY .` para provar que esses arquivos não são enviados ao build. O Dockerfile versionado não contém esse estágio de teste. A imagem final é inspecionada separadamente quanto a fontes, source maps, fixtures, segredos e TypeScript.

`test:docker` inicia dois containers reais, com `NODE_ENV=production`, configuração fictícia e rede `none`; faz HTTP dentro do container da API e comprova correlationId, Bun 1.4.2 e independência do worker ao encerrar a API. A ausência de PostgreSQL/SQS nesse smoke é intencional: estes adapters ainda não existem. Resposta HTTP 404 confirma o servidor sem registrar endpoints fora do escopo. Rotas de health e migrations na imagem continuam nos aceites 5.1/5.4.

### Logs JSON e correlação — 2.2

`JsonLogger` implementa `LoggerService` do NestJS, incluindo logs do framework, bootstrap e hooks de shutdown. Registros contêm `timestamp`, `level`, `service`, `event` e `correlationId` quando houver requisição. Eventos próprios: `process.starting`, `process.started`, `process.stopping`, `process.stopped`, `bootstrap.failed` e `http.completed`. Logs de erro/fatal vão para stderr; demais níveis, stdout. [NestJS: logger customizado](https://docs.nestjs.com/techniques/logger)

O middleware preserva `x-correlation-id` que corresponda a `^[A-Za-z0-9._:-]{1,128}$`; ausente/inválido gera UUID v4 e o devolve no header. `AsyncLocalStorage` mantém o contexto dos logs ao atravessar operações assíncronas e requisições concorrentes. O log HTTP contém método, status e duração, sem URL/query, headers ou body. [NestJS: AsyncLocalStorage](https://docs.nestjs.com/recipes/async-local-storage)

Por decisão de segurança, o logger só serializa campos operacionais permitidos. Mensagens livres, stack traces, objetos arbitrários e `cause` de erros são descartados, inclusive quando vêm do logger NestJS. Erros registram tipo seguro, códigos operacionais conhecidos e nomes de variáveis inválidas quando aplicável. Isso reduz detalhes de diagnóstico, mas impede que uma mensagem contendo connection string ou token os exponha; não depende de regex tentar identificar todos os segredos possíveis. Novos diagnósticos devem ganhar campos estruturados explícitos. Eventos de health degradada serão ligados quando health existir em 5.1.

### Evidências do segundo lote

| Verificação executada | Resultado |
|---|---|
| `git rm -r --cached .test-dist` | 3 arquivos retirados do índice, preservados localmente |
| Exclusões Git e inspeção do índice | Caminhos gerados/sensíveis verificados não serão adicionados por `git add` normal; `.env.example` permitido |
| `bun install --frozen-lockfile` | Sucesso; dependências/lockfile sem mudanças |
| `bun run typecheck` | Sucesso após corrigir a assinatura de retorno por papel |
| `bun run build` | Sucesso; mesmo build ESM já aprovado no lote anterior |
| `bun test` | **51 pass, 0 fail, 215 asserções** em quatro arquivos, incluindo regressão do primeiro lote |
| `DOCKER_CONTEXT=default bun run test:docker` | **1 pass, 0 fail, 22 asserções**, 10,30 s na execução final; imagem fixada por digest, API/worker em `NODE_ENV=production`, contexto/imagem inspecionados e recursos temporários removidos |
| `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive --json` | Change válida, zero issues, exit code 0 |
| `openspec instructions apply --change bootstrap-backend-foundation --json` | 7 concluídas, 27 pendentes; somente 1.5, 2.1 e 2.2 acrescentadas ao lote anterior |
| `git diff --check` e `git diff --cached --check` | Sucesso; sem erros de whitespace |

Cobertura nova: variáveis ausentes/inválidas, separação de papéis, URLs/credenciais locais, limites numéricos, boot inválido real com diagnóstico seguro; JSON de startup/shutdown/erro; IDs válidos, ausentes, inválidos e de tamanho limite; 12 requisições simultâneas com erro controlado preservando correlação e sem vazar senha/token/connection string. O erro de conexão é injetado em middleware técnico exclusivamente no processo do teste, sem criar endpoint de produção ou alegar teste PostgreSQL.

Problemas encontrados e resolvidos:

1. `desktop-linux`, contexto Docker inicialmente ativo, apontava para socket ausente. `docker --context default version` encontrou Engine 29.8.1 funcional. Os testes usam `DOCKER_CONTEXT=default` explicitamente, sem trocar contexto global. Ausência de Docker no comando de imagem causa falha, nunca skip silencioso.
2. O primeiro typecheck apontou `TS2352` no retorno genérico discriminado de configuração. Uma assinatura pública genérica com implementação retornando a união por papel resolveu o erro, preservando TypeScript strict.
3. Uma conferência de existência das fixtures coincidiu com a limpeza/recompilação feita pelo preload de testes. A conferência foi executada sequencialmente após a suite e passou; `git rm --cached` não apagou os arquivos locais. Não executar duas suites que compartilhem `dist/`/`.test-dist/` simultaneamente.

### Arquivos do segundo lote e reprodução

Criados: `.env.example`, `.dockerignore`, `Dockerfile`, `src/platform/config/configuration.ts`, `src/platform/logging/{json-logger,request-context,http-logging,logging.module}.ts`, `tests/support/environment.ts`, `tests/smoke/{configuration,logging}.test.ts` e `tests/docker/image.test.ts`.

Modificados: `.gitignore`, `package.json` (somente script `test:docker`), `src/bootstrap/{api,worker}.ts`, `src/composition/{api,worker}.module.ts`, `tests/support/process.ts`, `tests/smoke/bootstrap.test.ts`, `tasks.md` e este documento. As três exclusões no índice são as fixtures compiladas de `.test-dist/`; as fontes continuam em `tests/fixtures/`. README, proposal, design, seis specs, versões e lockfile foram preservados.

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
DOCKER_CONTEXT=default bun run test:docker
```

Para executar no host, copiar os valores fictícios de `.env.example` para `.env` local e usar `bun run start:api` / `bun run start:worker`. O smoke Docker prepara sua própria configuração e não requer `.env` nem serviços externos. Em máquinas com outro daemon funcional, ajustar ou omitir `DOCKER_CONTEXT`. Os testes de imagem são explícitos; `bun test` continua sendo a suite do host, sem declarar que testou Docker.

Próximo lote recomendado: **2.3 → 2.4 → 2.5**, para Compose com PostgreSQL/LocalStack, papéis reais e harness de integração. Migrations, clientes, filas, health, shutdown com deadline e todos os itens P1 permanecem pendentes.
