# Arquitetura — Jungle Gaming

Estado: fundação P0 da change `bootstrap-backend-foundation`. P1 permanece aberto; não existe domínio financeiro implementado. O [README](README.md) é fonte de verdade; [design OpenSpec](openspec/changes/bootstrap-backend-foundation/design.md) preserva justificativas, invariantes, ambiguidades e a matriz S13. Evidências executadas ficam em [implementation-notes.md](openspec/changes/bootstrap-backend-foundation/implementation-notes.md).

## D1 — Monólito modular, processos independentes

Um repositório e uma imagem compilada, com entrypoints NestJS separados para API e worker. API usa Express e oferece somente health; worker usa application context, sem listener HTTP ou consumers. Não há coordenação em memória entre processos. Os módulos futuros `wallets` e `wagering` seguirão `presentation → application → domain`; `infrastructure` implementará portas de aplicação. Domínio não dependerá de NestJS, MikroORM ou AWS SDK. Não criar interfaces, repositórios genéricos ou classes financeiras vazias por antecipação. Microservices/transações distribuídas não se justificam neste timebox.

## D2 — Build e compatibilidade verificáveis

Bun 1.4.2 é runtime, package manager e test runner. TypeScript 5.9.3 compila ESM sem bundling, com `strict`, decorators legados e metadata; imports locais terminam em `.js`. `reflect-metadata` precede a composição NestJS. NestJS 12.1.2, MikroORM 7.2.4/integração NestJS 7.1.0 e AWS SDK v3 3.1148.0 estão fixados no manifest/lockfile. Patches estritamente de declarações estão em [patches/README.md](patches/README.md).

O Docker usa Bun fixado por digest, instalação congelada e estágios separados. Runtime contém `dist/`, dependências de produção e manifest, executando como usuário `bun`; fontes/fixtures/segredos não entram. Testes exercitam decorators, DI, imports, rotas e migrations no JavaScript compilado, inclusive na imagem final. Typecheck sozinho não comprova o runtime.

## D3 — Configuração e lifecycle

Configuração imutável é validada por papel antes de abrir recursos. API/worker rejeitam credenciais migrator; provision não precisa de banco. Endpoint/região/credenciais SQS locais são explícitos, sem provider chain da máquina ou fallback AWS. Configuração inválida retorna código não zero e nomes de variáveis sem valores. Clientes lazy permitem liveness mesmo com dependências indisponíveis.

SIGTERM/SIGINT ativam draining, cancelam probes, param aceite HTTP, aguardam requests e fecham contexto NestJS, pools e clientes. Prazo padrão máximo de 25 s com grace period Compose de 30 s; sucesso retorna 0, erro/timeout retorna 1. O scaffold não possui mensagens em processamento; commit/ack e liberação de visibility serão responsabilidade dos consumers futuros. Shutdown travado e a matriz adversarial permanecem em P1.

## D4 — Compose e preparação explícita

`postgres` e `localstack` possuem healthchecks de acesso real. Jobs independentes `migrate` e `provision` antecedem API/worker por `service_completed_successfully`. Não existe schema sync, migration ou provisionamento implícito nos processos de aplicação. A mesma imagem suporta três workers sem `container_name` ou portas de worker publicadas.

Desenvolvimento e testes usam projetos/redes/volumes/databases/portas/filas separados. O harness gera UUIDs e confere ownership antes de limpar; o perfil `foundation` inclui todos os processos nos testes e no cleanup. SIGKILL/falha do daemon pode impedir cleanup; recuperação adversarial de resíduos continua P1 9.1.

PostgreSQL 17.10 tem volume persistente. LocalStack Community 4.14.0, fixado por digest, dispensa ativação nesta versão testada e usa URLs `dynamic`. Não há garantia de durabilidade das mensagens após recriar o emulador, nem promessa de paridade completa com AWS. Atualizar LocalStack exige rever conta/token, persistência e repetir testes. Mais detalhes em [docker/README.md](docker/README.md).

## D5 — MikroORM, PostgreSQL e migrations

MikroORM fornece Unit of Work, Identity Map e transações explícitas. Cada request HTTP tem RequestContext; cada execução de worker usa `WorkerDatabaseContext.run` com fork/contexto limpo em `finally`. `allowGlobalContext` é falso. Pool padrão máximo 5 por processo, com timeouts configurados; os probes usam conexões dedicadas e curtas, adicionais ao pool, para cancelamento sem atingir operações de aplicação. Dimensionar PostgreSQL para a soma dos processos/probes.

O use case futuro controlará uma única transação, propagando seu EntityManager aos adapters; repositórios não farão commits independentes. `wagering_app` não possui DDL. `wagering_migrator` cria objetos somente pelo runner/job. A migration técnica cria schema vazio `wagering` e permissões; histórico fica em `public`, legível pelo app, sem escrita. Reversão explícita usa `RESTRICT` e preserva histórico. Não existem tabelas financeiras.

Migrations compiladas têm `up`/`down` e catálogo compartilhado com a readiness. `up → up → down → up`, rollback, contextos isolados, privilégios e decimal exato são testados em PostgreSQL real descartável. Executar um migrator por vez até advisory lock e prova de concorrência em P1 6.1. Migrations financeiras precisarão de testes próprios, constraints e estratégia de preservação de dados.

## D6 — Dinheiro e invariantes futuras

Decisão aprovada, ainda não implementada: Money imutável encapsula decimal exato, recebe/serializa strings de escala 2, persiste em `NUMERIC(20,2)` + moeda e não usa `number`/`parseFloat`. A fixture técnica confirma round-trip de `"900719925474099.91"`; isso não testa Money. PostgreSQL pode arredondar excesso de escala, portanto a futura aplicação deve rejeitar entradas inválidas antes da escrita.

Wallet única por player/moeda, saldo não negativo, ledger append-only, unicidade de efeitos e FKs terão proteção SQL e de domínio. Saldo, ledger, transação, inbox e outbox compartilharão commit. Nenhuma publicação antes do commit. Ledger deve reconstruir o saldo em todo cenário financeiro. Factories/rehydrate preservam encapsulamento e terminalidade. Os contratos ainda precisam resolver escala de entrada, zero, referências, reversões e limites conforme as ambiguidades do design.

## D7 — Concorrência e entrega futuras

Decisão aprovada: pessimistic row locking por wallet (`SELECT ... FOR UPDATE`) sob `READ COMMITTED`, transações curtas e sem I/O SQS sob lock. Ordem wallet → transação/referência → lançamentos. Wallets distintas avançam em paralelo; não usar mutex local ou lock global. Constraints persistentes arbitram idempotência e reversões; erro que aborta transação exige novo contexto após rollback. `version` é sequência de mudanças de saldo, não substitui locks.

Inbox deduplica persistente e ack acontece após commit. Outbox terá claim/lease com `FOR UPDATE SKIP LOCKED`, publicação fora da transação e `eventId` estável. At-least-once pode duplicar entrega; FIFO não fornece exactly-once financeiro. Scheduler persistente tratará `PENDING_REFERENCE`, liberando a fila após gravação para não bloquear a chegada da referência. Nada disso está implementado neste P0.

## D8 — SQS e topologia

SDK usa endpoint/credenciais locais explícitos, descoberta de QueueUrl/QueueArn, retries limitados e timeout real. Provisionamento cria DLQ antes da principal. Ambas são FIFO, `ContentBasedDeduplication=false`, visibility 60 s, long poll 20 s. Retenções: principal 345600 s, DLQ 1209600 s. Redrive principal aponta ao ARN real da DLQ com limite 5; `RedriveAllowPolicy` é `byQueue` restrita à principal.

Reexecução compatível só lê e preserva mensagens. Drift existente falha com diagnóstico sem delete/recreate; reconciliação mutável é P1 7.1. Na criação, a DLQ fica brevemente com policy padrão até existir o ARN da principal; sucesso exige validar a ligação final antes de iniciar aplicação. Transporte send/receive/delete é testado exclusivamente com payload técnico isolado. Visibility/redelivery/redrive efetivo continuam P1 7.2–7.3.

## D9 — Health e logs

Health público separa processo vivo e dependências prontas. Readiness HTTP e `health:worker` compartilham SELECT/histórico/schema e leitura/validação de ambas as filas, em paralelo. Orçamento de I/O 1700 ms dentro de 2 s externos: conexão PostgreSQL dedicada read-only, timeouts SQL/conexão e socket cancelável; SQS de probe usa uma tentativa, AbortSignal e destruição do cliente. Não executar `db:status` como probe, pois é administrativo e pode preparar histórico.

Respostas incluem somente status e checks `postgresql`/`sqs` como `up`/`down`; falha HTTP retorna 503, draining inclui `reason: shutting_down`, worker retorna 1. Sem DDL, publicação, consumo ou ack. Recuperação é reavaliada sem restart. Probe worker não mede progresso de jobs. Logs JSON usam allowlist de campos e correlation ID HTTP validado/gerado; não expõem URL, senha, token ou payload. IDs/métricas financeiras obrigatórios serão adicionados quando os fluxos existirem.

## D10 — Evidências e limites do aceite

Bun Test é o único runner. `test:unit` inclui runtime compilado; integração e Docker usam PostgreSQL/LocalStack reais. `test:infra --scope=p0` executa typecheck/build, unidades/runtime, integração e smoke da imagem/Compose em sequência. Testes reais cobrem migrations reversíveis, privilégios, SQL rollback/isolamento, decimal exato, SQS, preparação, health, três workers simultâneos sem consumo e shutdown normal. Fixtures técnicas vivem somente em testes.

Sem filtro, `test:infra` requer também P1 e retorna `incomplete` enquanto suas tarefas/suites faltarem. P0 não comprova o desafio completo. Não executar suites concorrentes compartilhando `dist/`/`.test-dist/`; cleanup dos recursos Docker é isolado e ausência do daemon reprova, sem skips. As falhas injetadas são em recursos próprios, nunca no desenvolvimento.

## Organização dos arquivos

```text
src/
  bootstrap/          # api, worker, migrate, provision, health-worker
  composition/        # raízes NestJS e lifecycle do scaffold worker
  platform/
    config/           # validação por papel
    database/         # MikroORM, contextos, catálogo e migrations técnicas
    messaging/sqs/    # cliente, topologia e provisionamento
    health/           # checks compartilhados e controllers públicos
    lifecycle/        # draining e encerramento limitado
    logging/          # JSON e correlação
scripts/              # build e aceite da infraestrutura
tests/               # unit, smoke do host, integration, docker, fixtures/support
docker/postgres/     # bootstrap idempotente de database/papéis
openspec/changes/bootstrap-backend-foundation/
```

Módulos `wallets/{domain,application,infrastructure,presentation}` e `wagering/{...}` são destino futuro; não foram criados.

## Pendências e próxima etapa

As 13 tarefas P1 6.1–9.3 permanecem abertas: migrations concorrentes/falhas de DDL, contextos sob falhas concorrentes, drift SQS, visibility/redelivery/redrive, matriz avançada de indisponibilidade/draining/restarts/persistência, cleanup adversarial e aceite completo. O teste P0 com três workers e pausa básica não encerra os cenários adicionais de restart/falha em 8.x.

P0 permite propor F1 `implement-money-wallet-ledger`, sem iniciar sua implementação automaticamente. F2 cobre transações/idempotência/outbox atômica; F3 inbox/consumer; F4 publisher; F5 referências; F6 API/reconciliação; F7 consolidação concorrência/recuperação. Os **19 testes obrigatórios S13-U01–U05, I01–I06, C01–C08 e a invariante G01** estão mapeados para F1–F7 no [design](openspec/changes/bootstrap-backend-foundation/design.md); todos continuam financeiramente pendentes. P1 necessário deve preceder cada aceite financeiro dependente, e todo P1 antecede fechamento/entrega final.

Autenticação permanece fora deste lote. Na futura API financeira, adotar validação OIDC/JWT de IdP externo e ponto `ProviderIdentityPort` na borda de aplicação; não cadastrar usuários/senhas próprios. Não criar uma porta vazia no scaffold. Health continuará público; provider da fila continuará sujeito ao domínio. Métricas financeiras e logs com IDs de negócio são obrigatórios, enquanto dashboard/OTel, double-entry e carga são opcionais fora desta change.
