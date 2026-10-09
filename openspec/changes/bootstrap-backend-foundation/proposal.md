# Proposal

## Why

O repositório contém o enunciado completo do desafio em `README.md` e a configuração do OpenSpec, mas ainda não possui aplicação, dependências ou infraestrutura executável. Uma fundação reproduzível é necessária para implementar e comprovar posteriormente correção financeira, concorrência entre instâncias e recuperação de falhas com PostgreSQL e SQS reais.

## What Changes

- Preparar Bun 1.x, TypeScript `strict` e NestJS em um monólito modular, com composição e processos separados para API e workers.
- Estabelecer limites entre `domain`, `application`, `infrastructure` e `presentation`, mantendo o domínio futuro independente de NestJS e MikroORM.
- Definir instalação reproduzível, build, configuração validada, inicialização e encerramento dos processos.
- Disponibilizar Docker Compose com PostgreSQL, LocalStack, provisionamento idempotente das filas FIFO e execução controlada de migrations.
- Configurar MikroORM com PostgreSQL, isolamento de `EntityManager` e migrations versionadas com `up`/`down`; nesta etapa, somente um schema técnico vazio e o histórico do migrator.
- Provisionar `wager-transactions.fifo` e `wager-transactions-dlq.fifo`, sem consumir ou confirmar mensagens de negócio enquanto o use case não existir.
- Expor `GET /health/live` e `GET /health/ready`, públicos, com diagnóstico limitado e verificações reais de PostgreSQL e SQS.
- Criar a base de Bun Test com integração em containers e verificações de migrations, isolamento, ciclo SQS, health, reinicialização e múltiplos processos.
- Registrar em `design.md` a cobertura integral do README, invariantes financeiras, restrições eliminatórias, decisões futuras e ambiguidades. Na implementação, consolidar as decisões em `ARCHITECTURE.md` e acrescentar instruções operacionais ao README sem alterar o enunciado.

### Prioridade de execução

**P0** entrega a fundação mínima executável e testada para iniciar as changes de domínio: build NestJS realmente executado com Bun no host e no Docker, configuração, PostgreSQL/MikroORM, migrations versionadas e reversíveis testadas em banco real, filas SQS, health e integração básica. Typecheck isolado não comprova compatibilidade de runtime.

**P1** completa a robustez: migrations concorrentes, falhas avançadas, visibility/redrive, múltiplos processos e recuperação operacional. P1 permanece nesta change, rastreável em `tasks.md`, e deve ser concluído antes de seu encerramento e da entrega final. Concluir P0 libera o trabalho de domínio, mas não significa cumprir todas as specs ou concluir o desafio. Nenhum requisito obrigatório do README se torna opcional; o design associa cada teste da seção 13 às changes futuras responsáveis.

### Fora de escopo

Implementação de `Money`, `Wallet`, ledger, transações de apostas, inbox/outbox, reconciliação, autenticação, endpoints financeiros, consumidores/publishers/schedulers de negócio, métricas financeiras e testes de correção financeira. Suas obrigações permanecem registradas para changes posteriores; esta change não declara o desafio completo. Também ficam fora IdP, Redis, Kafka, Kubernetes, UI, double-entry bookkeeping, OpenTelemetry, dashboard e teste de carga.

## Capabilities

### New Capabilities

- `backend-runtime`: toolchain Bun/TypeScript/NestJS, limites modulares, configuração e processos independentes.
- `local-infrastructure`: ambiente Docker Compose reproduzível, inicialização ordenada e preservação dos dados PostgreSQL.
- `postgresql-foundation`: integração MikroORM, contextos isolados e ciclo reversível de migrations técnicas.
- `sqs-foundation`: cliente SQS local, provisionamento verificável de FIFO/DLQ e parâmetros de transporte.
- `health-checks`: contratos públicos de liveness/readiness e comportamento sob indisponibilidade.
- `infrastructure-testing`: suites Bun Test contra serviços reais e evidências verificáveis da fundação.

### Modified Capabilities

Nenhuma. Não existem specs principais anteriores no repositório.

## Impact

A implementação futura criará `src/`, `tests/`, `docker/`, `scripts/`, manifests Bun/TypeScript, Dockerfile, Compose e `ARCHITECTURE.md`. Introduzirá NestJS, MikroORM/PostgreSQL, AWS SDK for JavaScript v3 e ferramentas de teste/build executadas com Bun. A execução local exigirá Docker Compose e os pré-requisitos da versão fixada do LocalStack, incluindo token de ativação quando exigido.

Não há consumidores existentes nem breaking changes. **Nesta proposta, somente os artefatos de planejamento desta change são escritos**; nenhuma infraestrutura é iniciada e nenhum código de implementação é criado.
