# Infraestrutura local — P0 2.3–3.4

O Compose disponibiliza PostgreSQL e SQS via LocalStack. API, workers, jobs de migrations e provisionamento das filas de negócio ainda não fazem parte do Compose. A aplicação já integra MikroORM e possui runner de migrations separado. Não há tabelas financeiras nem schema `wagering` criado pelo bootstrap do container; esse schema pertence à migration técnica.

## Pré-requisitos e imagens

- Bun 1.4.2, Docker Engine funcional e Docker Compose **2.24.4 ou superior** (`!override` é usado para substituir portas nos testes). Validação realizada com Engine 29.8.1, Compose 2.40.3, Linux amd64; outras plataformas ainda não foram executadas.
- PostgreSQL `17.10-bookworm` e LocalStack Community `4.14.0`, ambos fixados por digest em `compose.yaml`.
- Downloads das imagens exigem acesso ao registry. PostgreSQL usa volume nomeado; LocalStack não recebe Docker socket nem volume de persistência neste lote.
- Portas de desenvolvimento publicadas somente em loopback: PostgreSQL `5432` e LocalStack `4566`. Alterar `POSTGRES_PORT` / `LOCALSTACK_PORT` em caso de conflito e ajustar os endpoints usados no host.

LocalStack Community 4.14.0 executou SQS **sem conta ou `LOCALSTACK_AUTH_TOKEN`** nos testes. A escolha mantém esta reprodução local independente de ativação. É uma versão antiga: não incorpora novas correções nem melhorias de paridade AWS. Versões atuais unificadas exigem conta/token; atualizar exige rever esses pré-requisitos e repetir os testes, sem substituir o emulador silenciosamente. A alternativa de fixar uma versão antiga e seus limites está documentada pelo [LocalStack](https://blog.localstack.cloud/localstack-single-image-next-steps/). Não inserir tokens em arquivos versionados, argumentos de comandos ou logs; uma eventual atualização deve exigir o token explicitamente e falhar com diagnóstico se ausente.

## Subir e consultar os serviços

```bash
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120
docker compose ps
docker compose exec -T postgres sh -c 'PGPASSWORD="$WAGERING_APP_PASSWORD" psql -X -h 127.0.0.1 -U wagering_app -d "$APP_DATABASE" -v ON_ERROR_STOP=1 -tAc "SELECT current_user, current_database()"'
docker compose exec -T localstack awslocal sqs list-queues --region us-east-1
```

Se o contexto atual não tiver daemon, selecionar explicitamente um contexto disponível, por exemplo `DOCKER_CONTEXT=default docker compose ...`. Não é necessário mudar o contexto global.

O healthcheck PostgreSQL verifica `pg_isready` **e** login TCP/`SELECT 1` com `wagering_app`; o de LocalStack executa `ListQueues`. Nenhum healthcheck cria schema, fila ou mensagem. Listagem vazia é esperada antes das tasks 4.x. No host, usar `localhost` com as portas publicadas; dentro da rede Compose, `postgres:5432` e `http://localstack:4566`. `SQS_ENDPOINT_STRATEGY=dynamic` permite que URLs reflitam o endpoint consultado.

Para parar sem apagar dados PostgreSQL:

```bash
docker compose down
```

Não usar `down --volumes` no desenvolvimento. Recriar LocalStack pode perder todas as filas/mensagens; não há promessa de durabilidade desse emulador. Testes de restart e recuperação ficam nas tarefas posteriores.

## Database e papéis

`docker/postgres/10-bootstrap.sh` roda pela imagem oficial PostgreSQL ao inicializar um volume vazio. Cria o database definido por `APP_DATABASE` (default `wagering`) se ausente; reutiliza database e roles existentes quando reexecutado. Identificadores/strings usam quoting do `psql`, sem interpolar senha no shell ou imprimi-la.

| Papel | Permissões |
|---|---|
| `wagering_admin` | Administração do container e propriedade do database; nunca disponibilizado à aplicação |
| `wagering_migrator` | Login, CONNECT, CREATE no database e USAGE/CREATE em `public`; sem superuser, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS |
| `wagering_app` | Login, CONNECT e USAGE em `public`; sem CREATE, TEMP, propriedade de schema ou associação ao migrator |

O bootstrap revoga os privilégios de `PUBLIC` sobre o database da aplicação e `public`, incluindo criação de tabelas temporárias. Não concede acesso genérico a tabelas futuras: as migrations deverão conceder DML no schema apropriado e somente SELECT no histórico, conforme D5. A autorização real é provada por SQL, não pela convenção dos nomes. Roles/URLs da aplicação e do migrator usam senhas distintas.

Defaults são fictícios e exclusivos do ambiente local. Para substituí-los, usar um arquivo ignorado como `.env.infrastructure` somente com `docker compose --env-file .env.infrastructure ...`; não carregá-lo na API/worker. A imagem da aplicação continua sem bootstrap, senhas administrativas ou fontes. Alterar variáveis de um volume já inicializado não atualiza automaticamente roles; a imagem oficial não repete scripts de init em volumes existentes. [PostgreSQL Docker: inicialização](https://hub.docker.com/_/postgres)

Reaplicação explícita do bootstrap, sem apagar database/objetos existentes:

```bash
docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-bootstrap.sh
```

Usa as variáveis do container existente. Executar serialmente; não é o runner de migrations nem uma garantia de coordenação entre migrators. Não cria `wagering`, histórico ou objetos de negócio.

## Integração real isolada

```bash
bun run typecheck
bun run build
DOCKER_CONTEXT=default bun run test:integration
```

O harness em `tests/support/infrastructure.ts` gera projeto `jungle-test-<uuid>`, database e nome de fila exclusivos. `compose.test.yaml` é independente e reutiliza as definições dos serviços por `extends`, com portas efêmeras em loopback e volume/rede privados. Não mesclar os dois arquivos com `-f compose.yaml -f compose.test.yaml`. O harness exige namespace/ownership, não lê `.env` nem herda `COMPOSE_FILE`, portas ou credenciais de desenvolvimento.

Setup aguarda healthchecks e comprova `SELECT 1` e `ListQueues` pelo host. Cleanup em `finally`, inclusive após falha de teste/setup, confere nome gerado, label Compose e label de ownership antes de executar `down --volumes` apenas no projeto próprio. Não usa `prune`, recursos externos ou cleanup por prefixo genérico. Verifica depois a ausência dos containers, rede e volume daquele projeto. O teste de coexistência inicia também uma instância privada de referência usando **compose.yaml**, sem acessar o projeto real de desenvolvimento do usuário.

Os testes criam somente fixtures técnicas em databases/filas descartáveis. Verificam autenticação por senha, privilégios, reexecução do bootstrap sem perda de dados, isolamento e limpeza após erro controlado. Não recebem mensagens e não implementam as filas financeiras principal/DLQ. Falta de Docker ou das variáveis obrigatórias do arquivo de teste falha explicitamente, sem mocks ou skip.

A suite também executa as migrations compiladas, isolamento de contextos HTTP/worker, rollback transacional e round-trip de `NUMERIC(20,2)` como string. `DOCKER_CONTEXT=default bun run test:docker` repete as migrations com a imagem final e PostgreSQL descartável, além do smoke existente. As fixtures ficam exclusivamente em `tests/fixtures`; o runtime não as inclui.

## MikroORM e migrations compiladas

API/worker usam `DATABASE_URL` com `wagering_app`; seu startup não modifica schema nem exige conexão bem-sucedida. MikroORM 7 abre conexões sob demanda, com pool/timeouts definidos em `.env.example` e `allowGlobalContext: false`. HTTP usa o RequestContext do adapter NestJS; cada execução futura de worker deverá usar `WorkerDatabaseContext.run`, que cria fork e limpa o identity map em `finally`. O callback aguarda todo o trabalho; não retornar promises de tarefas desacopladas nem reutilizar entidades/EntityManager entre execuções. Transações pertencem ao use case e usam `em.transactional()`, propagando o EM transacional aos adapters. Não há consumer criado por esse helper.

O runner só lê `MIGRATION_DATABASE_URL`, validada para `wagering_migrator`, sem exigir SQS/HTTP. A URL validada também fornece explicitamente host/porta/database/usuário/senha ao ORM, impedindo que variáveis `MIKRO_ORM_*` substituam esses campos. API/worker rejeitam `MIGRATION_DATABASE_URL` e nunca recebem a credencial migrator. Executar **um migrator por vez** até 6.1; ainda não existe advisory lock.

Após `bun install --frozen-lockfile` e `bun run build`, exemplo local com credencial fictícia:

```bash
NODE_ENV=development MIGRATION_DATABASE_URL='postgresql://wagering_migrator:local_migrator_password@localhost:5432/wagering' bun --no-env-file run db:status
NODE_ENV=development MIGRATION_DATABASE_URL='postgresql://wagering_migrator:local_migrator_password@localhost:5432/wagering' bun --no-env-file run db:migrate
```

Para credenciais próprias, fornecer variáveis somente ao processo migrator ou usar env-file ignorado exclusivo. Não colocar a credencial no `.env` de API/worker. Os comandos não compilam implicitamente: executar o build após mudar migrations. Na imagem, `bun run db:status`, `bun run db:migrate` e `bun run db:rollback` usam os mesmos `.js`; fornecer o ambiente migrator ao container e conectar à rede do PostgreSQL, usando `postgres:5432`. Não montar fontes. Os testes automatizados mostram essa execução completa em `tests/docker/migrations.test.ts`.

`db:status` retorna JSON com `executed`/`pending`; em database novo, o MikroORM prepara a tabela de histórico. Esse comando administrativo **não é** o futuro check read-only da readiness, que usará SELECT sob o papel app. `db:migrate` aplica pendências transacionalmente e sua repetição não reaplica passos concluídos. `db:rollback` desfaz **uma** migration por invocação; a migration inicial só remove o schema vazio, usando `RESTRICT`. Objetos adicionais fazem o comando falhar, preservando schema, objeto e histórico. O histórico `public.mikro_orm_migrations` e o SELECT de `wagering_app` permanecem após rollback. Erros retornam exit code 1 e diagnóstico JSON sem URL/senha.

O ciclo destrutivo `up → up → down → up` é automatizado apenas em databases descartáveis. Não executar a suite contra desenvolvimento nem reverter suas migrations para testar. Migrations financeiras futuras precisam de estratégia e testes próprios de preservação de dados. Esta migration não concede DML genérico sobre futuras tabelas.

Os patches de declarações usados com as versões fixadas estão documentados em [patches/README.md](../patches/README.md). Instalação congelada e estágios Docker aplicam os mesmos patches; não alteram JavaScript das dependências.

Uma interrupção não capturável (`SIGKILL`, falha do daemon/host) pode impedir `finally`; o projeto é anunciado no início e seus recursos têm labels para diagnóstico. Recuperação de resíduos após essas falhas, cleanup adversarial e execução completa P0/P1 pertencem a 9.1. Não executar simultaneamente suites do repositório que compartilhem `dist/` e `.test-dist/`; os ambientes de serviços do harness são independentes.

## Continuidade

`.dockerignore` permite as fontes TypeScript sob `src/`, incluindo o runner e migrations, e os patches necessários à instalação. A imagem final contém somente `dist/`, dependências de produção e manifest. O script de bootstrap PostgreSQL é um bind mount read-only do Compose e não deve ser copiado à imagem da API/worker.

Logs financeiros serão ampliados nas changes F1–F6, com eventos estruturados e `messageId`, `transactionId`, `walletId`, `providerId` quando existirem, preservando correlação e proteção contra payloads/segredos. Não criar IDs fictícios, métricas financeiras ou logging de negócio neste lote. A matriz S13 continua pendente.
