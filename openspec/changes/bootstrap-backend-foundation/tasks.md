# Tasks

P0 libera o início do domínio financeiro após evidências reais; P1 completa a robustez da fundação e permanece obrigatório antes do fechamento desta change e da entrega final. As seis specs descrevem o resultado completo P0+P1. Nenhuma tarefa P1 pode ser descartada por timebox; executar antecipadamente as que forem pré-requisito de uma change financeira.

O checklist registra somente tarefas com evidências de implementação. Manter a change aberta após este lote e após P0 enquanto houver pendências P1. As decisões D1–D10 e a matriz S13/F1–F7 em `design.md` continuam sendo referência.

Evidências dos lotes 1.1–1.4 e 2.1 → 1.5 → 2.2: [implementation-notes.md](implementation-notes.md). O segundo lote inclui correção do índice Git, configuração validada, imagem Docker executada e logs JSON/correlação. Compose, integração com PostgreSQL/SQS, health e migrations continuam pendentes.

## 1. P0 — Build compilado e processos sob Bun

- [x] 1.1 Fixar Bun 1.x e versões compatíveis de NestJS, TypeScript, MikroORM/driver/migrations/integração NestJS e AWS SDK v3; verificar peer dependencies e `bun install --frozen-lockfile` sem alterar o lockfile. Referência: `backend-runtime`, D2.
- [x] 1.2 Configurar TypeScript strict, build ESM, decorators/metadata, imports compilados e scripts `typecheck`/`build`; verificar build limpo e diagnóstico não zero para erro de tipo, sem usar typecheck como prova de runtime. Referência: `backend-runtime`, D2.
- [x] 1.3 Criar composição NestJS e entrypoints independentes `api`/`worker`, carregando metadata antes do bootstrap, sem consumer ou entidades financeiras; verificar boot dos dois processos JavaScript com Bun e independência de encerramento. Referência: `backend-runtime`, D1.
- [x] 1.4 Configurar Bun Test e smoke técnico do build compilado: metadata de decorators, injeção por construtor e imports entre módulos; verificar que a dependência injetada é usada de fato e que falha de DI/import reprova a suite, sem execução direta de `src/` como substituto. Referência: `backend-runtime`, `infrastructure-testing`, D2/D10.
- [x] 1.5 Criar Dockerfile com versão Bun fixada e artefatos compilados; verificar boot real da API e worker na imagem final sem bind mount/fallback de fontes e comprovar Bun 1.x como runtime. Completar a prova de rotas/migrations ao fechar 5.4. Referência: `backend-runtime`, `local-infrastructure`.

## 2. P0 — Configuração e dependências locais

- [x] 2.1 Implementar configuração validada por papel, `.env.example`, `.gitignore` e `.dockerignore`; verificar variáveis ausentes/inválidas, credenciais locais fictícias, endpoint SQS explícito sem fallback AWS e exclusão de segredos do Git/contexto Docker. Referência: `backend-runtime`, D3.
- [x] 2.2 Implementar logs JSON de lifecycle/erro e correlação HTTP; verificar JSON parseável, propagação/geração de `x-correlation-id` e ausência de senha, token e connection string em erro controlado. Referência: `backend-runtime`, D9.
- [ ] 2.3 Criar base Compose com PostgreSQL, LocalStack, rede e volume, usando imagens fixadas e pré-requisitos documentados; verificar `docker compose config`, PostgreSQL saudável e consulta SQS real, com diagnóstico de ativação ausente quando exigida pela versão. Referência: `local-infrastructure`, D4.
- [ ] 2.4 Configurar database e papéis `wagering_app`/`wagering_migrator` com credenciais separadas; verificar login de ambos e ausência de DDL/propriedade do schema para a aplicação, inclusive em `public`. Referência: `postgresql-foundation`, D5.
- [ ] 2.5 Preparar `compose.test.yaml` e helpers mínimos de recursos isolados com setup/polling/cleanup; verificar PostgreSQL/LocalStack reais, identificadores exclusivos, limpeza normal restrita e falha explícita por Docker/pré-requisito ausente. Essa base suporta os testes seguintes; o cleanup adversarial fica em 9.1. Referência: `infrastructure-testing`.

## 3. P0 — MikroORM e migrations reversíveis

- [ ] 3.1 Integrar MikroORM/PostgreSQL com pool limitado, contexto HTTP e fork/contexto por job, sem identity map global; verificar conexão real e contextos independentes, sem schema synchronization ou migration automática no startup. Referência: `postgresql-foundation`, D5.
- [ ] 3.2 Criar runner compilado e scripts `db:migrate`, `db:rollback`, `db:status`, com histórico em `public` e leitura para readiness; verificar execução via Bun na imagem final, sem fontes de migrations e sem credenciais migrator na API/worker. Executar um migrator por vez até 6.1. Referência: `postgresql-foundation`.
- [ ] 3.3 Criar migration técnica versionada `up`/`down` do schema vazio `wagering` e permissões, sem entidades/tabelas financeiras ou `CASCADE`; verificar `up → up → down → up` em PostgreSQL real descartável, incluindo histórico/status e ausência de reaplicação indevida. Referência: `postgresql-foundation`.
- [ ] 3.4 Adicionar integração básica de rollback SQL, dois contextos concorrentes isolados, privilégios e round-trip decimal; verificar ausência de escrita após rollback e retorno exato da string `"900719925474099.91"`, com fixtures somente em testes. Referência: `postgresql-foundation`, D5/D10.

## 4. P0 — SQS utilizável sem consumidor financeiro

- [ ] 4.1 Configurar cliente SQS local com timeout/retry limitados e descoberta de URLs; verificar acesso real pelo host e imagem sem hostname/account ID codificado nem fallback AWS. Referência: `sqs-foundation`, D4/D8.
- [ ] 4.2 Implementar `infra:provision` para principal e DLQ com atributos/políticas de D8 e reexecução segura; verificar atributos reais e segunda execução preservando mensagem, falhando sem delete/recreate se houver conflito. A reconciliação de drift fica em 7.1. Referência: `sqs-foundation`, `local-infrastructure`.
- [ ] 4.3 Testar send/receive/delete com payload técnico e IDs explícitos em fila isolada; verificar mensagem realmente recebida e confirmada, cleanup próprio e ausência de consumer financeiro na API/worker. Referência: `sqs-foundation`, `infrastructure-testing`.

## 5. P0 — Health, execução integrada e aceite do marco

- [ ] 5.1 Implementar `/health/live` e `/health/ready` públicos, com checks read-only de PostgreSQL/migrations e SQS/filas e orçamento de 2 s; verificar respostas 200/503, dependência indisponível/fila ausente, liveness independente e nenhum efeito em banco/fila. Referência: `health-checks`, D9.
- [ ] 5.2 Criar `health:worker` com as mesmas verificações sem HTTP público; verificar JSON e exit code 0/1 em cenários saudável/degradado, sem consumir mensagens ou alegar progresso de jobs. Referência: `health-checks`.
- [ ] 5.3 Completar Compose com jobs one-shot e processos condicionados ao sucesso da preparação, além de shutdown normal `SIGTERM`/`SIGINT` de 25 s e grace period 30 s; verificar startup completo, ausência de migration/provisionamento pela API/worker e liberação de recursos ao encerrar. Referência: `local-infrastructure`, `backend-runtime`.
- [ ] 5.4 Fechar P0 com `test:unit`, `test:integration`, `test:smoke` e `test:infra --scope=p0`: executar typecheck/build e suites reais, comprovar decorators/DI/imports/rotas HTTP e probe da imagem final, repetir migrations compiladas contra PostgreSQL real e registrar evidências. Acrescentar setup mínimo ao README sem alterar o enunciado e criar `ARCHITECTURE.md` com D1–D10, camadas, riscos e pendências P1/S13; verificar comandos reproduzíveis e relatório explicitamente parcial. Referência: todas as capabilities.

## 6. P1 — Robustez de migrations e persistência

- [ ] 6.1 Implementar advisory lock exclusivo do migrator em conexão dedicada com prazo limitado; verificar dois migrators reais simultâneos, aplicação única, timeout explícito e liberação do lock ao terminar. Nenhum lock global de wallets é introduzido. Referência: `postgresql-foundation`, D5.
- [ ] 6.2 Testar migration técnica com falha após DDL e reversão com objeto adicional; verificar rollback integral/histórico sem falso sucesso e recusa de remoção em cascata. Usar banco descartável e conjunto técnico de migrations delimitado mesmo se changes financeiras já existirem. Referência: `postgresql-foundation`.
- [ ] 6.3 Ampliar testes de persistência para falhas concorrentes e descarte/recriação de contexto; verificar que rollback de uma operação não contamina estado ou commit de outra e que novas operações usam contexto limpo. Referência: `postgresql-foundation`, `infrastructure-testing`.

## 7. P1 — Falhas e redelivery do transporte

- [ ] 7.1 Completar reconciliação de atributos mutáveis no provisionamento e diagnóstico de incompatibilidade não destrutiva; verificar correção de drift, preservação de mensagens e nenhuma exclusão/recriação em conflito. Referência: `local-infrastructure`, `sqs-foundation`.
- [ ] 7.2 Testar extensão/expiração/devolução de visibility e redelivery real em filas técnicas; verificar reentrega da mesma mensagem lógica e confirmação pelo receipt handle válido, com polling limitado e sem alegar exactly-once. Referência: `sqs-foundation`.
- [ ] 7.3 Testar redrive automático após limite de recebimentos em filas isoladas com tempos reduzidos; verificar mensagem realmente recebida na DLQ e indisponível na principal. Concluir 7.2–7.3 antes da aceitação financeira F3; esses testes técnicos não substituem inbox/retry de negócio. Referência: `sqs-foundation`, S13-I03/I05.

## 8. P1 — Falhas de processo e recuperação operacional

- [ ] 8.1 Testar boot com dependências indisponíveis, perda/retorno de PostgreSQL e SQS separadamente e juntos, migration pendente, drift de fila e conexão sem resposta; verificar liveness 200, readiness/probe negativos dentro de 2 s, cancelamento/limites e recuperação sem restart. Referência: `backend-runtime`, `health-checks`.
- [ ] 8.2 Exercitar health durante draining e shutdown com recurso travado; verificar readiness 503 enquanto houver listener, deadline de 25 s e saída não zero/diagnóstico em timeout, sem perder o caso normal P0. Referência: `backend-runtime`, `health-checks`.
- [ ] 8.3 Executar smoke com API e ≥3 workers independentes da imagem, encerrando/reiniciando um processo; verificar continuidade dos demais, probes, estado preservado e ausência de recebimento de mensagem de negócio pelo scaffold. Manter esse teste restrito à composição da fundação quando outros consumers já existirem. Referência: `local-infrastructure`, `infrastructure-testing`.
- [ ] 8.4 Testar restart de PostgreSQL com volume e de API/worker com dependências mantidas; verificar fixtures, histórico e mensagens preservados e readiness recuperada. Distinguir recriação do LocalStack de restart de aplicação; concluir antes dos testes financeiros equivalentes. Referência: `local-infrastructure`, `infrastructure-testing`, S13-I06/C08.

## 9. P1 — Evidência completa, documentação e fechamento

- [ ] 9.1 Completar harness P0+P1 e repetir suites, incluindo falha intermediária e coexistência com desenvolvimento; verificar setup/cleanup restrito em sucesso/falha, independência de resíduos, ausência de skip silencioso e que execução sem filtro abrange ambos os marcos. Referência: `infrastructure-testing`.
- [ ] 9.2 Atualizar README operacional e `ARCHITECTURE.md` com robustez validada, comandos, escala, limites/rollback, autenticação sem IdP e pontos de extensão futuros; verificar preservação do enunciado e rastreabilidade dos 19 testes §13 e da invariante S13-G01 para F1–F7, sem declarar suas evidências ainda inexistentes. Referência: design completo.
- [ ] 9.3 Executar `bun run typecheck`, `bun run build`, `bun run test:unit` e `bun run test:infra` completos; conferir todas as seis specs e `openspec validate bootstrap-backend-foundation --type change --strict --no-interactive`. Verificar que o diff atribuível a esta change permanece sem domínio financeiro e que todas as tarefas P0/P1 têm evidência antes do fechamento. Changes financeiras podem ter avançado separadamente após P0; isso não dispensa nenhum item desta change. Referência: todas as capabilities.

### Rastreabilidade da reorganização

Os IDs da primeira versão tinham 34 itens, todos pendentes. A tabela preserva seu destino mesmo quando uma tarefa foi dividida entre P0 e P1; não é uma segunda lista de execução.

| ID anterior | ID atual / prioridade |
|---|---|
| 1.1 | 1.1 — P0 |
| 1.2 | 1.2, 1.4 — P0 |
| 1.3 | 1.3 — P0 |
| 1.4 | 1.4 — P0 |
| 2.1 | 2.1 — P0 |
| 2.2 | 2.1 — P0 |
| 2.3 | 2.2 — P0 |
| 3.1 | 1.5, 3.2, 5.4 — P0 |
| 3.2 | 2.3 — P0 |
| 3.3 | 2.4 — P0 |
| 3.4 | 2.5 — P0; 9.1 — P1 |
| 4.1 | 3.1, 3.4 — P0; 8.1 — P1 |
| 4.2 | 3.2 — P0 |
| 4.3 | 3.3 — P0; 6.2 — P1 |
| 4.4 | 6.1, 6.2 — P1 |
| 4.5 | 3.4 — P0; 6.3 — P1 |
| 5.1 | 4.1 — P0 |
| 5.2 | 4.2 — P0 |
| 5.3 | 4.2 — P0; 7.1 — P1 |
| 5.4 | 4.3 — P0; 7.2, 7.3 — P1 |
| 6.1 | 5.1 — P0 |
| 6.2 | 5.1 — P0; 8.1 — P1 |
| 6.3 | 5.1 — P0; 8.1 — P1 |
| 6.4 | 5.2 — P0 |
| 7.1 | 5.3 — P0; 8.3 — P1 |
| 7.2 | 5.3 — P0; 8.2 — P1 |
| 7.3 | 8.3 — P1 |
| 8.1 | 2.5, 5.4 — P0; 9.1 — P1 |
| 8.2 | 8.1, 8.2 — P1 |
| 8.3 | 8.4 — P1 |
| 8.4 | 5.4 — P0; 9.1, 9.3 — P1 |
| 9.1 | 5.4 — P0; 9.2 — P1 |
| 9.2 | 5.4 — P0; 9.2 — P1 |
| 9.3 | 9.3 — P1 |
