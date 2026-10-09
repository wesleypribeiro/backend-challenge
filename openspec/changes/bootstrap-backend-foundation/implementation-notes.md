# Evidências de implementação — bootstrap-backend-foundation

Estado atual: **10/34 tarefas concluídas** — 1.1–1.5 e 2.1–2.5. Esta evidência não conclui P0 nem a change e não comprova garantias financeiras.

As seções seguintes registram o primeiro lote, que concluiu 1.1–1.4. Os demais lotes e suas evidências estão ao final deste documento; os registros históricos abaixo não substituem o estado atual.

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

Ao término do segundo lote, a sequência recomendada foi **2.3 → 2.4 → 2.5**. Ela foi executada no lote abaixo.

## Terceiro lote — P0 2.3, 2.4 e 2.5

Implementação na branch `develop`, somente infraestrutura local, bootstrap de database/papéis e testes isolados. Os sete itens já aprovados foram preservados. Dependências, `bun.lock` e código da aplicação não foram alterados. Migrations, schema `wagering`, filas de negócio, consumers, integração MikroORM e health da aplicação continuam pendentes. Não houve commit, push ou PR.

Instruções de uso, configuração, credenciais e limitações estão em [docker/README.md](../../../docker/README.md).

### Docker Compose e versões — 2.3

`compose.yaml` contém apenas `postgres` e `localstack`, rede `backend` e volume PostgreSQL `postgres_data`, todos com nomes derivados do projeto Compose, sem `container_name` ou recursos externos. Portas de desenvolvimento ficam em loopback e são configuráveis. Os jobs completos de migration/provisionamento, API e workers serão incorporados nas tarefas próprias.

| Imagem | Digest do índice consultado no registry e utilizado |
|---|---|
| `postgres:17.10-bookworm` | `sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f` |
| `localstack/localstack:4.14.0` | `sha256:3ebc37595918b8accb852f8048fef2aff047d465167edd655528065b07bc364a` |

LocalStack Community 4.14.0 foi escolhido para reproduzir SQS local sem ativação externa. Sua execução real sem token foi comprovada. É uma tag antiga, com limites de manutenção/paridade: futuras versões autenticadas exigem revisão de conta/token e não podem entrar por atualização silenciosa. Não foi armazenado ou solicitado token. O [anúncio oficial](https://blog.localstack.cloud/localstack-single-image-next-steps/) descreve essa alternativa e suas limitações. Não existe garantia de persistência ao recriar LocalStack; o volume persistente deste lote é somente PostgreSQL.

Healthcheck PostgreSQL combina `pg_isready` com `SELECT 1` autenticado como aplicação via TCP. O de LocalStack chama `awslocal sqs list-queues` com credenciais fictícias e endpoint local. Os testes também consultam PostgreSQL e SQS pelo host, verificam ambos como `healthy` e fazem consulta SQS dentro do container. Não se usa somente estado `running` como prova de acesso.

### Bootstrap e privilégios — 2.4

`docker/postgres/10-bootstrap.sh` é executado no init de volume vazio e pode ser reaplicado explicitamente. Usa `\getenv`, quoting do `psql` e criação condicional de database/roles. Não apaga objetos nem cria tabelas/schemas da aplicação. O database é propriedade de `wagering_admin`; credenciais da aplicação e do migrator são distintas.

- `wagering_app`: CONNECT e USAGE de `public`; sem CREATE no database/schema, TEMP, propriedade de schema, superuser, criação de roles/databases, replication ou bypass RLS; não é membro do migrator.
- `wagering_migrator`: CONNECT, CREATE no database e USAGE/CREATE em `public`, para criar o schema e histórico nas migrations futuras. Não recebe atributos de superuser, CREATEDB ou CREATEROLE.
- Nenhum grant genérico para tabelas futuras. Grants de DML e SELECT do histórico serão definidos nas migrations correspondentes.

Conexões TCP reais validaram os dois logins e rejeitaram senha errada (`28P01`). Como migrator, o teste criou somente `technical_probe.marker` e `public.technical_history_probe`, com DML explicitamente concedido ao papel de aplicação. Onze operações não autorizadas foram rejeitadas com `42501`: criação de schema, tabelas em `public`/schema técnico, tabela temporária, ALTER, DROP, TRUNCATE, criação de database/role e `SET ROLE wagering_migrator`. SELECT/INSERT autorizados funcionaram. O migrator removeu sua tabela técnica.

O bootstrap foi reexecutado duas vezes contra o mesmo database descartável: OID do database e os dois registros técnicos foram preservados, e a proibição de DDL em `public` continuou valendo. Nenhuma migration de negócio ou financeira foi executada. Scripts de init não rodam automaticamente em volumes existentes; a reaplicação explícita está documentada.

### Isolamento e cleanup — 2.5

`compose.test.yaml` reutiliza os serviços via `extends`, substitui portas com `!override` e exige namespace próprio. O harness gera `jungle-test-<uuid>`, database `wagering_test_<uuid>`, nome de fila técnica, portas efêmeras e label de ownership por execução. Não herda `.env`, `COMPOSE_FILE`, portas ou credenciais de desenvolvimento. Testes executam `pg` e AWS SDK v3 contra os containers reais; o cliente SQS da aplicação ainda não foi implementado.

Uma composição de referência baseada em `compose.yaml` é iniciada em projeto privado do teste, com marker SQL e fila técnica. Ao lado dela, o teste inicia e remove duas instâncias de `compose.test.yaml`, uma com sucesso e outra com erro deliberado. Comprova databases, filas, volumes e portas distintos; ausência dos markers no ambiente isolado; preservação do volume, registro SQL e fila da referência após ambas as limpezas. Nenhuma operação foi feita no projeto de desenvolvimento real do usuário.

Cleanup é limitado ao nome gerado e às labels de projeto/ownership, valida todos os recursos antes de `down --volumes` e verifica sua remoção depois. Não há `prune` nem alvo externo fornecido ao cleanup. Setup falho e falha no corpo do teste passam pelos caminhos de limpeza. O caso de erro controlado foi efetivamente executado; `SIGKILL`/queda do daemon e demais cenários adversariais permanecem em 9.1. Projetos são anunciados para permitir diagnóstico de resíduos se `finally` não puder executar.

O teste de pré-requisitos executa o próprio harness em processo filho apontado a socket Docker inexistente e exige falha explícita; outro caso valida a falha do Compose sem `TEST_PROJECT`. Não há substituição por mocks ou skip por ausência de infraestrutura. Compose 2.24.4+ é necessário para `!override`; validação realizada em Linux amd64, Engine 29.8.1 e Compose 2.40.3.

### Correções adicionais e continuidade

- `git rm openspec/changes/bootstrap-backend-foundation.zip` removeu o ZIP redundante do índice e workspace. A pasta original, proposal, design e seis specs foram preservados.
- `.dockerignore` documenta a inclusão automática de futuras migrations TypeScript sob `src/` e a necessidade de liberar explicitamente runners adicionais. O bootstrap PostgreSQL permanece fora da imagem da aplicação, montado read-only pelo Compose.
- `.env.example` acrescenta parâmetros de infraestrutura com senhas de bootstrap comentadas. Customizações administrativas devem usar env-file exclusivo da infraestrutura, nunca o `.env` carregado pela API/worker.
- A futura ampliação de logs financeiros está registrada em `docker/README.md`: eventos/IDs de mensagem, transação, wallet e provider nas changes F1–F6, mantendo correlação e exclusão de payloads/segredos. Nenhum código de logging financeiro foi adicionado.

### Comandos e resultados do terceiro lote

| Comando/verificação | Resultado real |
|---|---|
| `docker --context default version` / `compose version` | Engine 29.8.1 e Compose 2.40.3 acessíveis |
| `docker --context default buildx imagetools inspect` nas duas tags | Digests acima resolvidos; imagens publicadas para amd64/arm64 |
| `docker --context default compose -f compose.yaml pull` | Ambas as imagens baixadas com sucesso |
| `docker --context default compose -f compose.yaml config --quiet` | Exit code 0 |
| `TEST_PROJECT=jungle-test-config TEST_DATABASE=wagering_test_config INFRA_OWNER=config-check docker --context default compose -f compose.test.yaml config --quiet` | Exit code 0 |
| `bun run typecheck` / `bun run build` | Exit code 0, TypeScript strict preservado |
| `DOCKER_CONTEXT=default bun run test:integration` | 3 testes aprovados, zero reprovados, 56 asserções, 48,62 s na execução final; acesso, privilégios, coexistência, cleanup e falha de pré-requisitos reais |
| `bun test` | 51 aprovados, zero reprovados, 215 asserções; regressão dos lotes anteriores |
| `DOCKER_CONTEXT=default bun run test:docker` | 1 aprovado, zero reprovados, 22 asserções; imagem compilada preservada |
| Listagem de containers, volumes e redes por label `io.jungle.owner` após a suite | Sem recursos residuais dos testes |
| `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive --json` | Change válida, zero issues, exit code 0 |
| `openspec instructions apply --change bootstrap-backend-foundation --json` | 10 tarefas concluídas, 24 pendentes; somente 2.3–2.5 acrescentadas nesta execução |
| `git diff --check` / `git diff --cached --check` | Sem erros; código da aplicação, lockfile, README, proposal, design e seis specs preservados |

Problema encontrado: na primeira execução, `awslocal` retornou saída vazia para `ListQueues` sem filas e o teste tentou fazer `JSON.parse` dessa saída. As operações PostgreSQL já haviam passado e o cleanup funcionou mesmo nessa falha; a suite reportou 2 aprovados e 1 reprovado. O teste foi corrigido para consultar `length(QueueUrls || [])` com saída JSON explícita. A execução completa posterior passou. O diagnóstico de namespace ausente também foi refinado para identificar a variável sem imprimir valores.

Criados: `compose.yaml`, `compose.test.yaml`, `docker/postgres/10-bootstrap.sh`, `docker/README.md`, `tests/support/infrastructure.ts`, `tests/fixtures/postgresql-permissions.ts`, `tests/integration/local-infrastructure.test.ts`. Modificados: `.env.example`, `.dockerignore`, `package.json` (script `test:integration`), `tasks.md` e este registro. Removido: somente o ZIP redundante solicitado.

Ao término do terceiro lote, a recomendação foi **3.1 → 3.2 → 3.3 → 3.4**. Esse lote foi executado abaixo; filas de negócio, health, lifecycle completo, P1 e todos os testes financeiros da matriz S13 permanecem pendentes.

## Quarto lote — P0 3.1, 3.2, 3.3 e 3.4

Implementado na branch `develop`, sem commit, push ou PR. Somente esses quatro itens foram marcados, totalizando **14/34**, com **20 pendentes**. Proposal, design, seis specs, decisões de DDD/locking por wallet e separação de processos foram preservados. Nenhuma entidade, tabela, regra, endpoint ou consumer financeiro foi criado. Testes destrutivos operaram exclusivamente nos projetos/databases gerados pelo harness; o database de desenvolvimento não foi alvo.

### Integração MikroORM — 3.1

`DatabaseModule` utiliza `@mikro-orm/nestjs` e o driver PostgreSQL. MikroORM **7.2.4**, integração NestJS **7.1.0**, NestJS **12.1.2**, Bun **1.4.2** e TypeScript **5.9.3** continuam fixados; nenhuma dependência ou tecnologia nova foi instalada. As APIs efetivas foram conferidas nas declarações/JavaScript instalados e na documentação de [NestJS/MikroORM](https://mikro-orm.io/docs/usage-with-nestjs), [contextos](https://mikro-orm.io/docs/identity-map) e [migrations](https://mikro-orm.io/docs/migrations).

- MikroORM 7 inicializa sem exigir conexão antecipada; não usar a opção antiga `connect: false`. API/worker continuam iniciáveis com dependência inacessível. Nenhum startup chama schema synchronization ou migrations. A lista de entidades é vazia nesta fundação.
- HTTP usa o middleware RequestContext do adapter oficial. Worker expõe `WorkerDatabaseContext.run`, com novo fork por chamada e limpeza em `finally`; não agenda nem consome trabalho. Transações continuam a cargo do use case via `em.transactional()`. O callback deve aguardar todo o trabalho, sem reutilizar EM/entidades entre execuções.
- `allowGlobalContext: false`, pool mínimo 0/máximo configurado (default 5). `driverOptions` no v7 recebe diretamente as opções do `pg.Pool`: `connectionTimeoutMillis`, `query_timeout` e `statement_timeout`. Não usar o formato antigo aninhado em `connection`.
- Campos host/porta/database/usuário/senha são extraídos explicitamente da URL validada para impedir sobreposição por `MIKRO_ORM_*`. O teste injeta overrides conflitantes e comprova que a URL por papel prevalece. API/worker mantêm apenas `wagering_app` e rejeitam configuração migrator.
- Logs livres do ORM/SQL são desabilitados para evitar valores sensíveis. O runner usa diagnóstico JSON seguro e códigos PostgreSQL selecionados; erros reais de autenticação (`28P01`) são distinguíveis de `ConfigurationError`, sem senha/URL. Health/readiness e logging financeiro continuam nas tarefas próprias.

### Runner e migration técnica — 3.2–3.3

Scripts `db:migrate`, `db:rollback` e `db:status` executam `dist/bootstrap/migrate.js` sob Bun. Exigem build anterior e ambiente dedicado com `MIGRATION_DATABASE_URL` de `wagering_migrator`; não exigem HTTP/SQS nem usam a URL app como fallback. A lista explícita importa `Migration20261009000100.js`, sem descoberta de fontes TypeScript. As APIs do v7 são `orm.migrator`, `getExecuted()` e `getPending()`.

O runner comprova conexão ao database existente antes de preparar o migrator. `up`/`down` usam transações e `allOrNothing`; snapshots de geração são desabilitados. `db:rollback` desfaz um passo. **Ainda não há advisory lock: executar serialmente até 6.1.** O `db:status` administrativo pode inicializar o histórico em um database novo; a readiness futura fará SELECT read-only diretamente sob o papel app, sem chamar o migrator.

A migration cria apenas `wagering`, de propriedade de `wagering_migrator`, revoga acesso genérico, concede USAGE a `wagering_app` e concede somente SELECT em `public.mikro_orm_migrations`. Não há grants genéricos de DML nem tabelas no schema `wagering`. O histórico é criado pelo mecanismo MikroORM em `public`. `down` usa `DROP SCHEMA wagering RESTRICT`; remover o schema remove suas ACLs, preservando histórico e SELECT para diagnóstico de pendências. Objeto adicional provoca falha transacional, sem remoção em cascata.

O ciclo **up → up → down → up** foi executado no host e novamente na imagem final contra PostgreSQL descartável. Asserções conferem schema, proprietário, grants, status, histórico/id/data sem reaplicação no segundo up, histórico vazio mas ainda acessível após down e reaplicação. A recusa de down com tabela adicional preserva objeto/histórico e retorna não zero. Esse caso foi antecipado por solicitação explícita do usuário; **6.2 permanece pendente**, pois falta sua prova de falha deliberada após DDL. Nenhum outro item P1 foi marcado.

### Persistência real — 3.4

`tests/fixtures/persistence-record.ts` contém somente um `EntitySchema` técnico e DDL explícito, usado no database descartável. Sem schema sync e sem fixture distribuída no runtime. `technical_probe.record` recebe grants explícitos de DML; permissões de produção não foram ampliadas.

- Dois jobs sobrepostos usam EMs/entidades/transações independentes, comprovados por referências de objetos e `pg_backend_pid()` distintos. Barreiras com deadline sincronizam o ponto após flush, sem sleeps como evidência.
- Um job altera uma linha e insere outra, efetua flush e lança exceção. O outro observa somente o estado confirmado e confirma sua própria linha. SQL posterior comprova rollback de todas as escritas do primeiro e preservação do segundo commit.
- O identity map do contexto com falha é limpo, RequestContext não escapa e a próxima execução recebe EM novo, lê estado limpo e consegue confirmar nova escrita.
- Duas requisições HTTP reais usam controller técnico compilado em `.test-dist/`, injeção do EM e middleware do módulo de produção. Transações sobrepostas mantêm contextos/PIDs distintos. Nenhuma rota de teste entra em `src/` ou na imagem.
- Coluna real `NUMERIC(20,2)` e `DecimalType('string')`: gravação via Unit of Work, leitura em outro contexto e consulta SQL retornam **`"900719925474099.91"` como string exata**, sem Number/parseFloat. Precisão/escala são conferidas no catálogo PostgreSQL.
- SQL real nega CREATE/DROP no schema, DDL em `public`, INSERT/UPDATE/DELETE/TRUNCATE/DROP do histórico e `SET ROLE` ao app. O migrator cria/remove seus objetos; SELECT do histórico continua após rollback.
- Pool real configurado com máximo 2, timeout de conexão 300 ms e `statement_timeout` 150 ms; `pg_sleep(3)` falha dentro do limite observado e uma consulta posterior funciona. Configuração inválida e conexão com senha inválida têm diagnósticos distintos.

### Problemas encontrados e correções

1. A primeira compilação que de fato importou os tipos completos do ORM revelou **TS2344** em `CleanTypeConfig` de MikroORM 7.2.4 com `exactOptionalPropertyTypes`, e **TS2503** em `postgres-interval` 4.1.0 por referência a `Temporal.Duration`, ausente no lib ES2022/TypeScript 5.9.3. Foram criados dois patches de declarações com `bun patch`, documentados em [patches/README.md](../../../patches/README.md). `CleanTypeConfig` preserva a restrição por interseção com `TypeConfig`; a API Temporal não utilizada retorna conservadoramente `unknown` até haver tipos adequados. Nenhum JavaScript das dependências foi alterado. Não foram desabilitados strict, exact optional properties ou checagem de `.d.ts`.
2. O primeiro runner usava nomes de métodos da API anterior (`getMigrator`/`getExecutedMigrations`/`getPendingMigrations`), rejeitados pelo compilador. Foram substituídos pelas APIs v7 efetivas. Nessa iteração, Bun Test reportou **0 pass, 4 fail, 4 errors** porque o preload não compilou; não foi considerado sucesso. A comparação de referência de EMs com brands genéricos diferentes também foi ajustada para comparação booleana estrita, preservando a asserção e os tipos.
3. `package.json`/`bun.lock` registram os patches, sem alterar versões/resoluções. Dockerfile copia os patches antes das instalações congeladas em ambos os estágios; `.dockerignore` os permite. Uma instalação **nova em diretório temporário**, sem node_modules, aplicou ambos com `--frozen-lockfile`, e conferiu conteúdo dos patches e lockfile inalterado. A imagem também instalou/buildou/executou com esses patches.
4. O ambiente mantém contexto Docker funcional `default`; os comandos o selecionam explicitamente, sem trocar o contexto global. Não houve bloqueio de Docker, PostgreSQL ou LocalStack. Suites que compartilham `dist/`/`.test-dist/` foram executadas sequencialmente.

### Comandos e evidências do quarto lote

| Comando/verificação | Resultado real |
|---|---|
| `bun install --frozen-lockfile` em diretório temporário limpo com manifest/lock/patches | Exit 0; patches aplicados; lockfile inalterado; diretório removido |
| `bun run typecheck` | Exit 0, sem relaxar TypeScript strict |
| `bun run build` | Exit 0; runner e migration emitidos em JavaScript |
| `bun test` | **51 pass, 0 fail, 215 asserções** |
| `DOCKER_CONTEXT=default bun test ./tests/integration/postgresql-foundation.test.ts` | **6 pass, 0 fail, 83 asserções** na primeira execução real completa |
| `DOCKER_CONTEXT=default bun run test:integration` | **9 pass, 0 fail, 139 asserções**; inclui regressão da infraestrutura existente |
| `DOCKER_CONTEXT=default bun run test:docker` | **2 pass, 0 fail, 34 asserções**; API/worker e ciclo de migrations na imagem, com PostgreSQL real |
| `db:status`, `db:migrate`, `db:rollback` no host e na imagem | Executados pelos testes com credenciais de teste exclusivas; casos válidos exit 0, down não vazio/credencial app exit não zero |
| `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive --json` (CLI 1.13.1) | Válida, zero issues, exit 0 |
| `openspec instructions apply --change bootstrap-backend-foundation --json` | 14 concluídas, 20 pendentes; change ainda aberta |
| Listagem de containers/redes/volumes por label `io.jungle.owner` após os testes | Sem recursos residuais |
| `git diff --check`, `git diff --cached --check` e conferência do índice | Sem erros; `dist/`, `node_modules/`, `.test-dist/` e ambientes sensíveis consultados não estão versionados |

A última execução sequencial com falha imediata (`set -e`) concluiu typecheck, build, smoke (**19,94 s**), integração (**67,31 s**) e Docker (**45,07 s**) com exit 0. As contagens acima correspondem a essa execução final; os seis testes PostgreSQL também haviam passado isoladamente antes dela.

Os comandos que falham intencionalmente são asserções negativas aprovadas, não falhas da execução final. Nenhum teste financeiro foi executado ou marcado como satisfeito. As credenciais usadas nos testes são fictícias e os recursos são descartados pelo harness.

### Arquivos e continuidade

Criados: `src/platform/database/{orm-options,database.module,worker-database-context,migration-options}.ts`, `src/platform/database/migrations/Migration20261009000100.ts`, `src/bootstrap/migrate.ts`, `tests/support/{compiled,migrations}.ts`, `tests/fixtures/{persistence-record,database-controller}.ts`, `tests/integration/postgresql-foundation.test.ts`, `tests/docker/migrations.test.ts`, os dois `patches/*.patch` e `patches/README.md`.

Modificados: `src/bootstrap/{api,worker}.ts`, `src/composition/{api,worker}.module.ts`, `src/platform/logging/json-logger.ts`, `tests/support/infrastructure.ts`, `tests/docker/image.test.ts`, `package.json`, `bun.lock`, `Dockerfile`, `.dockerignore`, `docker/README.md`, `tasks.md` e este registro. O enunciado `README.md`, Compose, bootstrap de papéis e specs não foram modificados.

Ao término do quarto lote, a recomendação foi **4.1 → 4.2 → 4.3**. Esse lote foi executado abaixo; health/Compose integrado (5.x) e robustez P1 permanecem pendentes. A change continua aberta; 6.1–6.3 e demais P1 não são dispensados pelos testes. O conjunto técnico não comprova locking financeiro, atomicidade wallet/ledger/inbox/outbox nem qualquer cenário financeiro S13.

## Quinto lote — P0 4.1, 4.2 e 4.3

Implementado exclusivamente este lote na branch `develop`, partindo do quarto lote aprovado e do workspace limpo. Nenhuma tarefa 5.x/P1 foi implementada ou marcada. Não houve commit, push ou PR. Arquitetura, proposal, design, seis specs, enunciado, dependências e lockfile foram preservados. O checklist passa a **17/34 concluídas**, com **17 pendentes**; a change continua aberta.

### Cliente SQS — 4.1

`SqsConnection` usa **AWS SDK v3 `@aws-sdk/client-sqs` 3.1148.0**, já fixado, e os dados de `loadConfiguration` por papel. Endpoint, região e credenciais são explícitos; o cliente não procura AWS_PROFILE nem credenciais da máquina. `useQueueUrlAsEndpoint: false` mantém o destino de rede no endpoint validado, e `GetQueueUrl`/`GetQueueAttributes` obtêm URLs/ARNs do serviço. Não há hostname, account ID, ARN ou URL de fila construídos no código de produção SQS.

Retry `standard`, `maxAttempts` configurado (default 3, limite 5), timeout de conexão 1 s e `requestTimeout` configurado (default 25 s, maior que long poll de 20 s). Na versão instalada do handler, `throwOnRequestTimeout: true` é necessário para o prazo causar rejeição, em vez de apenas aviso. O provisionamento possui adicionalmente deadline total de 120 s, propagado por AbortSignal. Health terá orçamento próprio em 5.1, sem reutilizar esse prazo longo.

`SqsModule` compõe API/worker via NestJS e fecha o cliente no lifecycle. Inicializar esses processos não acessa a rede SQS nem cria/recebe/confirma mensagens. No teste, ambos iniciam antes das filas existirem e o emulador continua vazio; os clientes injetados resolvem posteriormente as filas reais.

O cliente foi comprovado pelo host e pela imagem final. O teste troca mensagens nos dois sentidos usando o mesmo LocalStack, com origins distintas para host/container e ARNs iguais obtidos por consulta. Configuração alternativa de `AWS_PROFILE`, `AWS_ENDPOINT_URL_SQS` e `AWS_MAX_ATTEMPTS` não sobrepõe os valores explícitos. O endpoint interno do Compose é fornecido como configuração do container de teste, não codificado no cliente.

### Provisionamento separado — 4.2

`bun run infra:provision` executa somente `dist/bootstrap/provision.js`, com build prévio e sem fontes TypeScript. O processo exige apenas as variáveis do papel `provision`, sem banco/HTTP ou credencial migrator. `.env.example` já contém os nomes/valores seguros necessários; comandos e limitações estão em [docker/README.md](../../../docker/README.md).

O preflight consulta ambas as filas e rejeita incompatibilidades antes de modificar recursos existentes. Cria primeiro a DLQ, lê seu ARN e cria a principal com `RedrivePolicy`; depois lê o ARN da principal e completa `RedriveAllowPolicy` na DLQ. O contrato efetivamente consultado é:

| Atributo | Principal | DLQ |
|---|---|---|
| Nome padrão de configuração | `wager-transactions.fifo` | `wager-transactions-dlq.fifo` |
| FifoQueue | `true` | `true` |
| ContentBasedDeduplication | `false` | `false` |
| VisibilityTimeout | `60` | `60` |
| ReceiveMessageWaitTimeSeconds | `20` | `20` |
| MessageRetentionPeriod | `345600` | `1209600` |
| RedrivePolicy | ARN real da DLQ, `maxReceiveCount=5` | Ausente |
| RedriveAllowPolicy | Não exigida | `byQueue`, somente ARN real da principal |

Na preparação inicial, a ligação da DLQ é finalizada depois de conhecer o ARN da principal; existe brevemente a policy padrão do serviço. A ligação ausente também pode ser completada em uma preparação parcial compatível. O comando só retorna sucesso após consultar e verificar a configuração final. Não introduzir consumers antes desse sucesso; a ordenação dos jobs no Compose é de 5.3.

Uma reexecução com topologia compatível apenas consulta/verifica: o teste observa os comandos reais do SDK, sem substituir suas respostas. Duas invocações do CLI preservaram ambas as filas, ARNs/URLs, timestamps, tags acrescentadas pelo teste e mensagens com os mesmos IDs/corpos. Policies são comparadas pelos campos, não pela ordem textual do JSON.

Divergências existentes são rejeitadas com exit 1 e diagnóstico JSON `provision.failed`, `SQS_QUEUE_CONFLICT`, `queueRole` e `attribute`, sem credenciais/URLs/payloads. Tipo standard incompatível e drift de visibility foram testados contra filas reais, preservando recursos/mensagem. Não existe DeleteQueue, PurgeQueue ou recriação no provisionador. Reconciliação de atributos mutáveis permanece em **7.1**; este P0 apenas falha explicitamente diante de drift.

As referências de comportamento consultadas foram [CreateQueue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html), [SetQueueAttributes](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SetQueueAttributes.html) e [SQS no LocalStack](https://docs.localstack.cloud/aws/services/sqs/), além do código/tipos das versões instaladas. A prova executada é do LocalStack fixado, não uma homologação contra AWS real.

### Transporte e isolamento — 4.3

O harness existente cria PostgreSQL/LocalStack reais em projetos `jungle-test-<uuid>`, com databases, filas, redes, volumes e portas exclusivos. Os nomes SQS são técnicos e derivados do namespace do teste; nenhuma operação atingiu as filas de desenvolvimento. Setup/cleanup existentes foram reaproveitados, incluindo cleanup após a primeira falha desta implementação.

As mensagens técnicas usam `MessageGroupId` e `MessageDeduplicationId` explícitos. Os testes conferem MessageId, corpo e atributos recebidos, usam o ReceiptHandle real em DeleteMessage e fazem nova consulta vazia após confirmação; a contagem de mensagens não visíveis complementa essa verificação. Mensagens nas duas filas sobreviveram à reexecução do provisionamento, e `ApproximateReceiveCount=1` na primeira leitura do harness confirma ausência de consumo observado pelos scaffolds durante o teste.

No Docker, o mesmo provisionador compilado roda duas vezes e preserva a mensagem enviada pelo host. O cliente compilado no container recebe/confirma essa mensagem, verifica nova leitura vazia e envia outra mensagem técnica para leitura/confirmação pelo host. A imagem continua sem `src/`, testes ou bind mount de fontes, executando Bun 1.4.2. Não houve mudança no Dockerfile ou `.dockerignore`: os novos `.ts` sob `src/` já fazem parte do build permitido e os testes continuam excluídos da imagem.

Não foram implementados inbox, outbox, publisher, consumers, retries financeiros, endpoints/entidades/tabelas financeiras, extensão de visibility ou redrive automático. FIFO não comprova idempotência de negócio. Os cenários 7.2–7.3 e todos os testes financeiros S13 permanecem pendentes.

### Problemas encontrados e soluções

1. **Credenciais congeladas e SDK:** a primeira integração real terminou com **0 pass / 3 fail**. O SDK tenta anexar `$source` às credenciais, mas `loadConfiguration` entrega objetos imutáveis; isso provocou TypeError antes da chamada SQS. O cliente passou a fornecer uma cópia das credenciais ao SDK, preservando a configuração original congelada. A regressão comprova essa preservação e o provisionamento real passou. Nenhuma versão ou patch de dependência precisou ser alterado.
2. **Tipos das opções resolvidas:** o primeiro typecheck encontrou TS2339 ao inspecionar `httpHandlerConfigs` e TS2349 ao tratar `retryMode` como sempre uma função. Os testes foram corrigidos com narrowing explícito da interface real do SDK; se o handler esperado não existir, o teste falha. Não foram usados `any`, relaxamento de strict ou remoção de asserções.
3. **Limite efetivo do handler:** a inspeção do código/tipos instalados mostrou a necessidade de `throwOnRequestTimeout: true`. Foi configurado e conferido no handler após acesso real ao LocalStack. Falhas avançadas e testes de recuperação continuam em P1.

### Comandos e resultados do quinto lote

| Comando/verificação | Resultado real |
|---|---|
| `bun run typecheck` | Exit 0, strict preservado |
| `bun run build` | Exit 0, entrypoint e módulos SQS emitidos como ESM `.js` |
| `bun test` | **56 pass, 0 fail, 243 asserções**, 20,76 s |
| `DOCKER_CONTEXT=default bun test ./tests/integration/sqs-foundation.test.ts` | **3 pass, 0 fail, 47 asserções** após a correção das credenciais |
| `DOCKER_CONTEXT=default bun run test:integration` | **12 pass, 0 fail, 186 asserções**, 79,18 s; inclui PostgreSQL e infraestrutura anteriores |
| `DOCKER_CONTEXT=default bun run test:docker` | **3 pass, 0 fail, 53 asserções**, 66,57 s; API/worker, migrations e SQS reais |
| `bun run infra:provision` pelo harness no host e imagem | Sucesso em configurações válidas/reexecução; exit 1 nos casos negativos esperados |
| `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive --json` | Válida, zero issues, exit 0 |
| `openspec instructions apply --change bootstrap-backend-foundation --json` | 17 concluídas, 17 pendentes; state `ready` para próximos lotes |
| Listagem de containers/redes/volumes por label `io.jungle.owner` após as suites | Sem recursos residuais |
| `git diff --check` / `git diff --cached --check` | Sem erros; nenhum commit, push ou PR |

A validação final executou typecheck, build e as três suites sequencialmente com `set -e`: **71 testes aprovados, zero reprovados e 482 asserções**. Os três testes SQS isolados são subconjunto desses 71, não somados novamente. Nenhum teste foi skipped por indisponibilidade de infraestrutura ou substituído por mock.

### Arquivos alterados e próximos passos

Criados: `src/platform/messaging/sqs/{sqs-connection,sqs.module,provision,provision-conflict}.ts`, `src/bootstrap/provision.ts`, `tests/support/sqs.ts`, `tests/smoke/sqs.test.ts`, `tests/integration/sqs-foundation.test.ts` e `tests/docker/sqs.test.ts`.

Modificados: `src/composition/{api,worker}.module.ts`, `src/platform/logging/json-logger.ts`, `package.json` (somente script `infra:provision`), `docker/README.md`, `tasks.md` e este documento. Os testes anteriores foram preservados e executados. Nenhuma mudança de dependências, lockfile, imagens, Compose, banco ou decisões arquiteturais.

Próximo lote recomendado, **sem implementação nesta execução**: **5.1 → 5.2 → 5.3 → 5.4**, health HTTP, probe worker, Compose com jobs/lifecycle e aceite integrado P0. P1 continua obrigatório antes do fechamento da change. O término deste lote não conclui P0 nem o desafio financeiro.


## Sexto lote — P0 5.1–5.4 concluído; P1 pendente

### Gate antes de 5.3: health HTTP e worker

Implementados `/health/live`, `/health/ready` e `health:worker` no JavaScript compilado. Critérios PostgreSQL incluem `SELECT 1`, histórico `public.mikro_orm_migrations` compartilhado com o catálogo do runner e presença do schema. Probe usa conexão `pg` dedicada, sessão read-only, timeouts limitados e socket próprio destruído ao abortar/finalizar; não disputa nem cancela operações no pool MikroORM. O SQS reutiliza a configuração local e contrato de topologia, com cliente curto, uma tentativa e AbortSignal compartilhado. Prazo de I/O de 1700 ms reserva 300 ms do orçamento externo de 2 s para inicialização CLI, limpeza e resposta. Nenhuma mutation no probe.

Evidências executadas antes de iniciar 5.3:

- `bun run typecheck`: exit 0 após corrigir anotação `Record<string, string>` no ambiente do teste.
- `DOCKER_CONTEXT=default bun test ./tests/integration/health.test.ts`: **2 pass, 0 fail, 76 assertions**, 27,76 s, com PostgreSQL e LocalStack reais.
- `bun test ./tests/unit ./tests/smoke`: **58 pass, 0 fail, 258 assertions**, 18,73 s; preload recompila aplicação/fixtures.
- SQL/histórico ausentes e filas ausentes produzem checks negativos; preparar recupera a mesma API. Drift técnico de visibility é detectado sem correção automática. Mensagem permanece com primeiro recebimento pelo harness e histórico não muda.
- Pausa controlada dos dois containers mantém conexões sem resposta: API mantém liveness, readiness e CLI terminam em menos de 2 s, retomam depois de unpause e não deixam sessões `jungle-readiness`. Isso cobre o limite básico solicitado; não encerra a matriz adversarial P1 8.1.

Sem mudanças nas dependências ou nos limites dos clientes de operação; sem entidades financeiras.

### Compose e shutdown — 5.3

Compose agora inclui `migrate`, `provision`, `api` e `worker` na imagem compilada, além das dependências. Somente migrator recebe `MIGRATION_DATABASE_URL`; somente aplicação recebe `DATABASE_URL`; provisionador recebe apenas configuração SQS. Dependências usam `service_healthy`/`service_completed_successfully`; worker não publica porta e aceita escala 3. `compose.test.yaml` ativa os processos via perfil `foundation`, preservando o uso anterior somente das dependências.

SIGTERM/SIGINT ativam draining e cancelam probes ativos, param aceite HTTP, aguardam requests antes de fechar contexto NestJS/pools/clientes e encerram normalmente com código 0. Prazo máximo configurável até 25 s; timeout/falha retorna 1, com log seguro; Compose concede 30 s. Não há trabalho financeiro em andamento ou ack inventado. O teste de shutdown travado continua P1 8.2.

- `docker --context default compose --env-file /dev/null config --quiet` e configuração de teste com perfil `foundation`: exit 0.
- `bun run typecheck`: exit 0. Ajustado `app.close()` à interface pública NestJS; o sinal fica no evento `process.draining`, sem casts ou patches adicionais.
- Primeira execução do smoke integrado: 80 asserções passaram, mas cleanup falhou porque perfil inativo excluía os novos containers do `down`. Corrigido cleanup para incluir `--profile foundation`; ownership continua validado antes de qualquer remoção. Os seis containers parados e a tag exclusivos dessa execução foram removidos após conferência de projeto/owner.
- Reexecução `DOCKER_CONTEXT=default bun test ./tests/docker/compose.test.ts`: **1 pass, 0 fail, 82 assertions**, 33,54 s. Imagem sem fontes, jobs terminados antes dos processos, três workers simultâneos, health HTTP/CLI, credenciais separadas, config inválida, SIGINT/SIGTERM com saída 0, mensagem recebida uma única vez pelo harness após shutdown e cleanup completo.
- `DOCKER_CONTEXT=default bun test ./tests/docker/preparation-failure.test.ts`: **1 pass, 0 fail, 20 assertions**, 28,38 s. Falha de configuração em cada job impede startup da API/worker; serviços/recursos preparados permanecem até cleanup próprio.

### Arquivos do sexto lote

- `ARCHITECTURE.md`
- `README.md`
- `compose.test.yaml`
- `compose.yaml`
- `docker/README.md`
- `openspec/changes/bootstrap-backend-foundation/implementation-notes.md`
- `openspec/changes/bootstrap-backend-foundation/tasks.md`
- `package.json`
- `scripts/test-infra.ts`
- `src/bootstrap/api.ts`
- `src/bootstrap/health-worker.ts`
- `src/bootstrap/worker.ts`
- `src/composition/api.module.ts`
- `src/composition/worker.module.ts`
- `src/platform/database/migration-catalog.ts`
- `src/platform/database/migration-options.ts`
- `src/platform/health/health.controller.ts`
- `src/platform/health/health.module.ts`
- `src/platform/health/readiness.ts`
- `src/platform/lifecycle/shutdown.ts`
- `src/platform/logging/json-logger.ts`
- `src/platform/messaging/sqs/provision.ts`
- `src/platform/messaging/sqs/queue-topology.ts`
- `tests/docker/compose.test.ts`
- `tests/docker/preparation-failure.test.ts`
- `tests/integration/health.test.ts`
- `tests/smoke/health-worker.test.ts`
- `tests/smoke/shutdown.test.ts`
- `tests/support/infrastructure.ts`
- `tests/unit/health.test.ts`

Não houve novas dependências, alteração do lockfile, imagens de dependências, tabelas ou entidades financeiras. `.dockerignore` foi conferido: a allowlist `src/**/*.ts` já inclui health/lifecycle e migrations; a imagem final continua sem `src/`, scripts de teste, `.env`, chaves ou fixtures. A prova Docker de exclusão permanece ativa.

### Aceite integrado P0 — 5.4

`DOCKER_CONTEXT=default bun run test:infra --scope=p0` executado com **exit 0**, relatório JSON `scope: p0`, `status: passed`, `p1: pending`, `financialTests: pending`. O wrapper executou sequencialmente:

| Comando efetivo | Resultado real |
|---|---|
| `bun run typecheck` | exit 0, strict sem relaxamento |
| `bun run build` | exit 0, ESM compilado com decorators/metadata |
| `bun run test:unit` | **63 pass, 0 fail, 282 assertions**, 23,59 s; inclui os testes Bun existentes e novos testes técnicos |
| `bun run test:integration` | **14 pass, 0 fail, 262 assertions**, 98,24 s; PostgreSQL/LocalStack reais |
| `bun run test:smoke` | **5 pass, 0 fail, 155 assertions**, 99,91 s; mesmas suites de `test:docker`, imagem final e Compose integrado |

São **82 testes distintos aprovados** no aceite, sem falhas finais ou skips. As suites recompilam aplicação/fixtures antes de usar o JavaScript; scripts usam Bun, sem Jest ou runtime Node obrigatório.

Após o aceite, a revisão acrescentou uma asserção explícita ao teste existente: rollback da migration técnica no banco descartável deixa histórico legível e readiness/probe retornam `postgresql: down, sqs: up`; reaplicar recupera a mesma API. Foi executado novamente `bun run typecheck` (exit 0) e `DOCKER_CONTEXT=default bun test ./tests/integration/health.test.ts`: **2 pass, 0 fail, 87 assertions**, 28,31 s. Essa repetição inclui os dois testes de health já contados, não acrescenta testes distintos nem altera código da aplicação.

Validações adicionais:

- `bun run test:infra` sem filtro: **exit 1 esperado**, `scope: all`, `status: incomplete`, listando 6.1–9.3. Não executar apenas P0 e rotular como suite completa. O manifesto futuro `tests/p1/**/*.test.ts` e as tarefas P1 precisam ser completados antes de liberar o aceite sem filtro.
- Compose de desenvolvimento e Compose de teste com perfil `foundation`: `config --quiet` aprovado. Não iniciamos nem removemos recursos de desenvolvimento.
- `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive --json`: válido, zero issues. As seis specs permanecem presentes; elas descrevem P0+P1, não somente este aceite parcial.
- README original preservado byte a byte como prefixo: **27.497 bytes**. Documentação operacional apenas acrescentada; `ARCHITECTURE.md` registra D1–D10, estrutura, trade-offs, limites, autenticação futura e continuidade S13/F1–F7.
- `git diff --check` aprovado. `dist/`, `.test-dist/`, `node_modules/` e `.env` continuam ignorados e sem arquivos rastreados.
- Cleanup concluiu sem containers, redes ou volumes dos testes restantes; sem commit, push, PR ou archive. Branch mantida em `develop`.

### Limitações e continuidade

P0 comprovou runtime/build, preparação e conectividade reais, permissões/migrations reversíveis, precisão decimal técnica, health com prazo/recuperação e lifecycle básico. Essas evidências permitem começar a proposta F1 `implement-money-wallet-ledger`; não são prova de correção financeira. Não implementamos Money, Wallet, ledger, transações, inbox/outbox, consumers, endpoints ou métricas financeiras.

P1 continua obrigatório: advisory lock de migrators e falhas SQL avançadas (6.x), reconciliação de drift/visibility/redelivery/redrive (7.x), indisponibilidade/draining/restarts/persistência avançados (8.x), cleanup adversarial/documentação/aceite completo (9.x). O smoke básico de três workers e pausa de dependências solicitado nesta execução não marca 8.x. Executar os pré-requisitos P1 antes dos testes financeiros correspondentes; concluir as 13 tarefas antes de fechar a change e entregar o desafio.

A edição fixada do LocalStack segue sem persistência garantida ao recriar o emulador; PostgreSQL mantém volume. Testes foram executados no Docker context `default`, preservando o contexto global. Timeout de shutdown tem implementação, mas o cenário de recurso travado pertence a 8.2. A garantia do probe foi medida nas falhas reais deste lote; a matriz adversarial mais ampla permanece 8.1.

Fontes técnicas consultadas durante o apply: [pg.Client — timeouts e fechamento](https://node-postgres.com/apis/client), [Compose — dependências e ordem de startup](https://docs.docker.com/compose/how-tos/startup-order/), [NestJS — lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events). Os detalhes de cancelamento também foram conferidos no código das versões instaladas e validados com serviços reais; documentação externa não substituiu os testes.
