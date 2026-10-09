# Design

## Context

Fonte de verdade: [README.md](../../../README.md), lido integralmente, seções 1–14. Motivação e escopo estão em [proposal.md](proposal.md). O repositório inspecionado contém apenas o README, configuração e skills OpenSpec; não há código, manifests, testes, Docker ou specs principais. Não existe implementação anterior a preservar ou migrar.

Este documento distingue **decisões executáveis nesta fundação** de **diretrizes para changes financeiras futuras**. As últimas registram as obrigações do README, mas não autorizam criar entidades, tabelas ou regras financeiras nesta change. Os títulos estruturais e termos normativos seguem o schema OpenSpec; a documentação é em português e os contratos permanecem em inglês.

### Rastreabilidade de todos os requisitos

| README | Requisito ou restrição | Tratamento nesta change / continuidade obrigatória |
|---|---|---|
| §1, §3 | Correção com duplicação, desordem, concorrência, morte do processo e indisponibilidade de PostgreSQL/SQS | Infraestrutura e processos reais agora; invariantes e recuperação financeira em changes posteriores. |
| §2 | Autenticação opcional, sem pontos; se implementada, IdP externo; sem usuários/senhas próprios | Não integrar IdP nesta etapa. Health público. `ARCHITECTURE.md` futuro registra OIDC/JWT e reserva `ProviderIdentityPort` para a change da API; não criar uma porta vazia agora. Identidade de provider da fila continuará validada no domínio. |
| §4 | Bun 1.x como runtime/package manager/test runner, TypeScript strict, NestJS, PostgreSQL, SQS local, Compose e migrations reversíveis | Coberto pelas seis specs desta change. MikroORM e LocalStack são escolhas explícitas do usuário; não adotar outro ORM/emulador. |
| §5 | Nove restrições invioláveis | Mapeadas abaixo como R1–R9; nenhuma pode ser dispensada por conveniência do bootstrap. |
| §6.0 | Classes encapsuladas, construtores restritos, factories e `rehydrate` sem repetir transições | Convenção futura de domínio; entidades ORM separadas e domínio sem decorators. |
| §6.1 | `Money` imutável; decimal string de escala 2; moedas; rejeição de entradas inválidas | Diretriz monetária abaixo; implementação e testes unitários futuros. |
| §6.2 | Wallet única por player/moeda, saldo não negativo, ledger equivalente, versão e moeda | Diretriz de schema/concorrência; nenhuma tabela `wallet` criada agora. |
| §6.3 | `OPENING` interno; estados e transições explícitos; key/payload conflitante | Estados e ambiguidades registrados abaixo; use case futuro. |
| §6.4 | Ledger imutável, aritmética verificável, unicidade por transação/wallet, sem entrada para `LOSS`/rejeição | Garantias futuras no banco e no domínio. Double-entry é opcional e fica fora. |
| §6.5, §11 | Inbox, transação, saldo, ledger e outbox atômicos | Uma unidade de trabalho PostgreSQL; publicação apenas após commit; persistência financeira adiada. |
| §7 | `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`, referências e replay original | Invariantes e ambiguidades abaixo; sem endpoints/use cases nesta change. |
| §7.1–7.2 | Worker agendado, backoff, limite/TTL, rejeição e evento por referência inexistente; códigos estáveis | Direção futura registrada; não instalar scheduler de negócio agora. |
| §8 | Unidade de concorrência `walletId`, paralelismo entre wallets e ≥3 instâncias | Locks por linha no futuro; composição sem singleton de coordenação; teste de ≥3 processos da fundação não comprova a race financeira. |
| §9 — criação/consulta | `POST /wallets`; `GET /wallets/:walletId`; `GET /wallets/:walletId/ledger?cursor=...&limit=50`; consultas de transação por ID interno e por provider/ID externo | Todos adiados. Abertura positiva gera `OPENING` + ledger na mesma SQL transaction; duplicidade é conflito; cursor do ledger deve ser estável e opaco. |
| §9 — submissão | `POST /wagering/transactions`; header obrigatório; JSON canônico; replay; códigos HTTP distintos | Adiado. Registrar decisão de hash e distinção entre respostas; não aceitar apostas em um scaffold sem processamento. |
| §9 — reconciliação | `POST /wallets/:walletId/reconciliation`; saldo armazenado/reconstruído/diferença, `consistent`, `checkedEntries` | Adiado; divergência será resposta + log + métrica, nunca correção silenciosa. |
| §9 — health | `GET /health/live`, `GET /health/ready`, públicos | Coberto nesta change, incluindo indisponibilidade e recuperação. |
| §10 | Filas e envelope `WagerTransactionRequested`, mesmo use case HTTP/SQS, inbox, ack pós-commit, classificação de erros, tentativas, shutdown | Filas, cliente e ciclo de transporte testado agora; consumidor, inbox, taxonomia e ack de negócio depois. |
| §11 — eventos | `WagerTransactionProcessed` (inclusive `LOSS`), `WagerTransactionRejected`, `WalletBalanceChanged` (só mudança de saldo), `WagerTransactionPendingReference` | Futuros. Envelope por classe abstrata e subclasses, `eventType`/`version` no tipo, `MoneyProps` em `data`, timestamps ISO-8601. |
| §12 | Logs JSON, IDs de correlação, sem payload financeiro; métricas de status/duplicatas/retries/DLQ/locks/outbox lag/latência; health separado | Logs mínimos de processo/health agora. IDs financeiros e métricas serão acrescentados quando existirem operações; OpenTelemetry/dashboard opcionais fora. |
| §13 | Unitários, integração real, oito cenários de concorrência/falha e igualdade final saldo/ledger | Testes de infraestrutura agora; checklist financeiro completo abaixo permanece pendente. Nenhum teste futuro pode ser substituído pelo smoke da fundação. |
| §14 | Financeiro 20, concorrência 20, idempotência 15, mensageria 15, arquitetura 10, testes 10, observabilidade 5, docs 5 | Priorizar base verificável para os 70 pontos de correção/concorrência/idempotência/mensageria. Não consumir o timebox com autenticação ou extras. README operacional e `ARCHITECTURE.md` serão entregues no apply. |
| §14 — opcionais | Carga com `bun run test:load`, ambiente/metodologia/throughput/p50/p95/p99/erros/conflitos/outbox lag, sem meta RPS | Fora desta change, assim como double-entry, OTel e dashboard. |

### Restrições invioláveis e eliminatórias

| ID | Restrição | Garantia prevista e evidência futura |
|---|---|---|
| R1 | Dinheiro nunca em `number`, `float` ou `double` | String → decimal exato → PostgreSQL `NUMERIC`; testes acima de `Number.MAX_SAFE_INTEGER` em centavos e round-trip. **Eliminatória.** |
| R2 | Idempotência não pode depender de memória | Constraints persistentes, hash e snapshot do resultado; testar restart e replay. **Eliminatória.** |
| R3 | FIFO não é a garantia final de consistência | Inbox + unicidade + lock/transação SQL; simular duplicação mesmo com diferentes IDs de dedup do broker. |
| R4 | Nunca publicar evento antes do commit financeiro | Outbox na mesma transação; publisher separado. **Eliminatória.** |
| R5 | Nunca sobrescrever/excluir ledger | Append-only no domínio, privilégios e triggers de banco; testar SQL direto com papel da aplicação. Ausência de ledger auditável é **eliminatória**. |
| R6 | Nenhum lock global para todas as wallets | Lock da linha da wallet; wallets diferentes não se bloqueiam por coordenação global. |
| R7 | Proibido `read → calculate → update` sem concorrência controlada | Leitura sob `FOR UPDATE` dentro da transação; `CHECK` não negativo como última barreira. Saldo negativo por race é **eliminatório**. |
| R8 | Correção com múltiplas instâncias | Sem mutex/process-local cache como garantia; cenários com ≥3 processos. Correção apenas em uma instância é **eliminatória**. |
| R9 | Unicidade, imutabilidade e não-negatividade no schema | `UNIQUE`, FKs, `CHECK`, índices e proteção append-only versionados; testes contra PostgreSQL real. Débito/crédito duplicado é **eliminatório**. |
| R10 | Testes não podem substituir completamente PostgreSQL e SQS por mocks | Suites com containers reais desde a fundação. Substituição completa por mocks é **eliminatória**. |

## Goals / Non-Goals

**Goals:** tornar reproduzíveis build, inicialização, migrations, conectividade, health e testes; separar lifecycle de API e workers; reduzir riscos de runtime/ORM/SQS antes de qualquer fluxo monetário.

**Non-Goals:** não criar um framework genérico de repositórios, abstração multi-broker, CQRS/event sourcing, tabelas financeiras antecipadas ou workers que removam mensagens sem use case. A primeira migration terá efeito técnico real e reversível, sem tabelas fictícias em produção para satisfazer testes.

## Decisions

### D1. Monólito modular e processos independentes — fundação

Um repositório, um grafo de dependências e uma imagem; dois entrypoints: `api` e `worker`. A API serve HTTP via NestJS; o worker usa um application context NestJS sem servidor HTTP público. Não há consumer iniciado pela API. O worker inicial mantém lifecycle/configuração/conexões e um probe executável, mas **não chama `ReceiveMessage` nem `DeleteMessage` em filas de negócio**.

Os futuros contextos `wallets` e `wagering` concentram as regras. Dependências apontam para dentro: `presentation → application → domain`; `infrastructure` implementa portas de `application`; composição NestJS fica nas bordas. Domínio não importa NestJS, MikroORM, AWS SDK ou estruturas de HTTP. Não introduzir interfaces sem consumidor. Entidades de persistência serão mapeadas para domínio pelas factories `rehydrate`.

Microservices acrescentariam contratos remotos e transações distribuídas sem benefício para o timebox. Um único processo impediria escalar/publicar/encerrar workers independentemente. Futuramente o mesmo entrypoint worker poderá receber papéis de consumer, publisher e reprocessamento; esses papéis não são implementados aqui.

### D2. Toolchain e compatibilidade — fundação

Bun 1.x executa instalação, scripts, processos e Bun Test. TypeScript faz typecheck separado e build com `strict`, `experimentalDecorators` e `emitDecoratorMetadata`; `reflect-metadata` é carregado antes da composição NestJS. Preferir saída ESM sem bundling e imports resolvíveis em `dist/`, incluindo migrations. Usar o adapter HTTP padrão Express do NestJS para reduzir variáveis.

Compilar com `tsc` executado por Bun e executar o JavaScript gerado com Bun evita depender de diferenças entre transpilers para metadata. Os testes de integração iniciam os mesmos entrypoints compilados usados pelo container. Não pressupor que a execução direta de `.ts` prove compatibilidade de build. A documentação do Bun descreve transpilation de TypeScript; a escolha de compilação explícita é uma decisão do projeto. [Bun: TypeScript](https://bun.com/docs/typescript)

**Aceite obrigatório em P0:** após build limpo, o smoke executa os entrypoints JavaScript de `dist/` com Bun, verifica metadata de decorators em uma dependência técnica injetada por construtor, resolução real da cadeia de DI, registro das rotas de health e imports de módulos compilados. Repete a execução na imagem final, sem bind mount de fontes e sem fallback para `src/`, e comprova Bun 1.x como runtime do processo. O bootstrap do worker também resolve suas dependências. Qualquer falha de metadata, DI, import ou inicialização reprova P0, mesmo com typecheck aprovado. Após existirem migrations, os comandos compilados também precisam funcionar nessa imagem. Estas são evidências a produzir no apply; esta revisão documental não executa nem comprova o build.

Na primeira tarefa de implementação, fixar versões exatas de Bun 1.x e um conjunto mutuamente compatível de NestJS, MikroORM, driver PostgreSQL, migrations, integração NestJS, TypeScript e AWS SDK v3; validar peer dependencies. Pacotes MikroORM centrais/driver/migrations devem permanecer alinhados. Gravar `bun.lock`, versão Bun e imagens com tag fixa/digest; instalação com `bun install --frozen-lockfile`. Não usar `latest` nem apresentar versões ainda não testadas como compatíveis. Não é necessário escolher outro framework se um patch falhar.

**Registro do apply 1.1–1.4:** Bun 1.4.2, NestJS 12.1.2, MikroORM 7.2.4 (integração NestJS 7.1.0) e TypeScript 5.9.3 foram fixados. O compilador JavaScript do TypeScript roda sob Bun, com `NodeNext` e imports locais terminados em `.js`; as fixtures de DI também passam por `tsc`, evitando tomar transpilation direta do runner como prova de metadata. Versões completas, decisões técnicas e evidências estão em [implementation-notes.md](implementation-notes.md). O smoke deste lote comprova o host; imagem, health e migrations continuam pendentes, sem alterar o aceite completo de P0.

Contratos de scripts: `bun run typecheck`, `bun run build`, `bun run start:api`, `bun run start:worker`, `bun run db:migrate`, `bun run db:rollback`, `bun run db:status`, `bun run infra:provision`, `bun run health:worker`, `bun run test:unit`, `bun run test:integration`, `bun run test:smoke` e `bun run test:infra`. Wrappers fazem os preparativos necessários; nenhum script usa Jest, npm ou Node como runtime obrigatório. `db:rollback` desfaz uma migration por invocação explícita; não é executado automaticamente em startup/shutdown.

### D3. Configuração e lifecycle — fundação

Configuração validada antes de abrir listener/conexões: `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` (somente migrator), `AWS_REGION`, `AWS_ENDPOINT_URL`, credenciais locais AWS, nomes das duas filas, limites de pool/timeouts e prazo de shutdown. CLI migrator não exige configuração HTTP. Exemplos de credenciais locais são fictícios; `.env` e tokens ficam fora do Git.

No perfil local, endpoint SQS explícito é obrigatório e não pode cair silenciosamente no endpoint AWS real ou na cadeia de credenciais da máquina. Usar região `us-east-1` e credenciais fictícias `test`/`test`. A conexão da aplicação usa papel PostgreSQL sem DDL; migrator utiliza credencial própria. Portas, contagens, versão, tentativas e durações podem ser `number`: a proibição é sobre dinheiro.

Configuração inválida encerra o processo com código não zero e nome das variáveis inválidas, sem valores secretos. Configuração válida com dependência temporariamente indisponível permite o processo permanecer vivo com readiness negativa; inicialização de clientes/pools deve evitar bloquear o listener indefinidamente ou exigir conexão bem-sucedida no construtor. Contextos ORM não usam identity map global. Timeouts de conexão/consulta são limitados.

`SIGTERM`/`SIGINT` ativam draining, impedem novo trabalho e fecham HTTP/pool/cliente com prazo inicial de 25 s; Compose concede 30 s. Encerramento normal retorna zero; falha/timeout é logado e retorna não zero. Não há mensagens em andamento neste bootstrap. A extensão futura deverá aguardar commit/ack ou liberar visibilidade, mantendo os limites; não inventar ack no shutdown atual.

### D4. Docker Compose e provisionamento — fundação

Serviços: `postgres`, `localstack`, `provision` (one-shot), `migrate` (one-shot), `api` e `worker`; um perfil de testes usa os mesmos tipos de serviços, nomes/portas/volumes isolados. `postgres` usa volume nomeado e `pg_isready`. `provision` espera SQS responder com prazo limitado e cria/verifica filas. `migrate` aguarda PostgreSQL saudável. API/worker aguardam conclusão bem-sucedida de ambos os jobs. Condições `service_healthy` e `service_completed_successfully` evitam confundir container iniciado com dependência pronta. [Docker Compose: startup order](https://docs.docker.com/compose/how-tos/startup-order/)

Preferir job versionado com AWS SDK ao hook embutido do LocalStack: permite repetir provisionamento explicitamente e reaproveitar o código no harness. Executar novamente preserva mensagens e filas; divergências em atributos mutáveis são reconciliadas e verificadas; tipo incompatível falha com diagnóstico, sem apagar/recriar fila. API/worker não provisionam recursos nem executam migrations automaticamente.

Endereços internos usam `postgres`/`localstack`; execução no host usa portas publicadas. `GetQueueUrl` resolve URLs em cada ambiente, sem fixar account ID/host. Configurar estratégia de URL do LocalStack compatível com o endpoint solicitado (`dynamic`) e validar acesso de dentro do container e do host. [LocalStack: SQS](https://docs.localstack.cloud/aws/services/sqs/)

Não fixar `container_name` nem publicar uma porta de worker; permitir `--scale worker=3`. A imagem usa o mesmo artefato compilado e Bun fixado em build/runtime, com sinal entregue ao processo principal. Não montar Docker socket no LocalStack, pois apenas SQS é necessário.

A documentação atual do LocalStack inclui conta/token de ativação; a implementação deve fixar uma versão e documentar seus pré-requisitos, sem gravar `LOCALSTACK_AUTH_TOKEN`. Isto é um pré-requisito operacional, não troca autorizada por MiniStack. [LocalStack: desenvolvimento local](https://docs.localstack.cloud/aws/getting-started/local-development/)

Persistência PostgreSQL é garantida pelo volume. **Não prometer durabilidade de mensagens ao recriar/matar o emulador**: persistência LocalStack é baseada em snapshots e depende de configuração/edição. Nesta etapa, restart de serviço significa API/worker preservando PostgreSQL/LocalStack; restart de PostgreSQL é testado com volume. Reinicialização do LocalStack reprovisiona filas, mas pode perder mensagens do ambiente local. Essa limitação não autoriza perder eventos confirmados na solução futura. [LocalStack: persistence](https://docs.localstack.cloud/aws/developer-tools/snapshots/persistence/)

### D5. PostgreSQL, MikroORM e migrations — fundação

MikroORM foi escolhido pelo Unit of Work, Identity Map, controle explícito de transações e locks. Request HTTP recebe contexto próprio; cada execução concorrente de worker/job recebe um novo fork/contexto, descartado ao terminar. `allowGlobalContext` permanece desabilitado. Uma aplicação de negócio futura abrirá a transação na camada de aplicação e propagará o mesmo `EntityManager` transacional aos adapters; nenhum repositório fará commit independente. [MikroORM: contextos](https://mikro-orm.io/docs/identity-map), [MikroORM: transações](https://mikro-orm.io/docs/transactions)

A migration inicial cria apenas o schema `wagering`, incluindo USAGE do papel de aplicação; o histórico do migrator fica em `public`, fora do schema revertido. Conceder ao papel de aplicação somente leitura da tabela de histórico para readiness, sem alteração do histórico ou criação de objetos em `public`. `down` remove somente o schema vazio e permissões correspondentes, sem `CASCADE`; o histórico e sua leitura permanecem para diagnosticar a migration pendente. Papéis e database são bootstrap do container; objetos da aplicação são migrations. O papel `wagering_app` não possui DDL nem propriedade do schema. O papel `wagering_migrator` é dono dos objetos e só está disponível no job/comando de migration.

Não habilitar schema synchronization, schema update ou geração automática na inicialização. Migrations TypeScript versionadas têm `up` e `down` explícitos e são incluídas no build; caminhos de descoberta não dependem de fontes ausentes na imagem final. Aplicação não usa migrator por injeção acidental. Execução `up → up → down → up` em banco descartável deve provar histórico, idempotência e reversibilidade. Uma migration de teste deliberadamente falha valida rollback do DDL, sem ser distribuída no diretório de migrations de produção. [MikroORM: migrations](https://mikro-orm.io/docs/migrations)

Compose tem um único job migrator. Para comandos externos simultâneos, um advisory lock **exclusivo do migrator** protege a sequência de migrations e produz timeout explícito; aquisição e liberação usam a mesma conexão dedicada, mantida durante toda a execução. Isso não coordena wallets e não viola R6. Pools são limitados por processo: início com máximo 5 conexões por API/worker, mais orçamento separado para migrator/testes. Dimensionar `max_connections` para ≥3 workers + API + jobs; nada depende de um pool compartilhado entre processos.

O ciclo versionado/reversível e os testes PostgreSQL básicos são P0. A proteção e a prova de concorrência entre comandos migrator são P1; até concluí-las, executar apenas um migrator por vez no ambiente de desenvolvimento, sem alegar suporte validado à execução simultânea. A implementação final continua obrigada a atender à spec de exclusividade. Migrations financeiras posteriores também terão testes próprios de reversão e constraints; o teste do schema vazio não as cobre.

### D6. Dinheiro, persistência e invariantes — diretrizes futuras, sem schema financeiro agora

Representação proposta: `Money` encapsula decimal arbitrário, recebido/construído a partir de strings, e persistência em `NUMERIC(20,2)` + código de moeda. Mapeamento explícito converte string decimal para `Money.rehydrate`/factory equivalente e serializa com duas casas; proibir coerções por `Number`, `parseFloat` e tipos ORM que retornem dinheiro como JS number. A precisão/limite de 18 dígitos inteiros deverá integrar o contrato da change monetária, incluindo overflow; BRL pode ser o único valor aceito operacionalmente, preservando comparações multi-moeda.

`NUMERIC` é exato, mas coluna com escala declarada arredonda valores com escala maior antes de constraints observarem o valor. Portanto rejeitar entradas com mais de duas casas **antes** de persistir, sem tratar o cast como validação. Não há arredondamento de entrada autorizado pelo README; operações de soma/subtração em escala 2 são exatas. Testes de arredondamento devem provar ausência de arredondamento silencioso. [PostgreSQL: numeric](https://www.postgresql.org/docs/17/datatype-numeric.html)

| Invariante | Regra preservada / proteção a detalhar na change financeira |
|---|---|
| Precisão e moeda | JSON `{ "amount": "25.00", "currency": "BRL" }`; rejeitar `NaN`, `Infinity`, expoente, vazio, excesso de casas e negativos de entrada. Operações internas podem produzir valor negativo para diferenças/negação, nunca saldo negativo. Operação e wallet têm mesma moeda. |
| Wallet única | `UNIQUE(player_id, currency)` e `NOT NULL`; criação concorrente retorna conflito para a perdedora. |
| Saldo e versão | `CHECK` de saldo finito/não negativo; `version = 1` na criação, inclusive abertura positiva; incrementar só quando saldo muda. Não usar auto-versionamento ORM que incremente em mudanças sem efeito financeiro. |
| Ledger | `UNIQUE(wallet_id, transaction_id)`; FKs; valores/antes/depois finitos; `balance_before ± amount = balance_after`; antes/depois não negativos. Bloquear `UPDATE`, `DELETE` e `TRUNCATE` pelo papel da aplicação e triggers apropriadas; sem cascata destrutiva a partir de wallet/transação. |
| Saldo ↔ ledger | Toda mudança de saldo tem exatamente o lançamento correspondente e vice-versa; mesma SQL transaction. Consistência entre tabelas não é um `CHECK` comum: transação + locks e reconciliação/testes são necessários, com eventual constraint trigger desenhada na change de ledger. |
| Abertura | Saldo inicial positivo gera `OPENING` interno + crédito atômico; zero não cria movimentação; API/fila nunca aceitam `OPENING`. |
| Efeitos | `BET` debita com saldo suficiente; `WIN` credita; `LOSS` processa sem ledger/saldo; `REFUND` credita `BET` processada; `ROLLBACK` inverte `BET`, `WIN` ou `REFUND` processados. Rejeições não alteram saldo/ledger. |
| Referências | Resolver por `(providerId, referenceExternalTransactionId)`; conferir provider/player/wallet/moeda/round, kind permitido, status `PROCESSED` e valor integral igual. Nenhuma reversão parcial. |
| Reversões únicas | Unicidade da reversão efetiva por referência e kind, com índice parcial para efeitos `PROCESSED`; relação entre tipos distintos é ambiguidade registrada adiante. Referência ausente não consome o direito de reversão. |
| Idempotência de negócio | Persistir key, hash, identidade externa e resultado original; `UNIQUE(provider_id, external_transaction_id)` e constraint da key conforme escopo a ratificar. Replay não recalcula saldo atual nem repete efeitos. |
| Inbox | `UNIQUE(consumer_name, message_id)`; o `messageId` do envelope é diferente do `MessageId`/receipt handle SQS. Payload diferente sob o mesmo identificador é conflito auditável. |
| Atomicidade/eventos | Inbox quando aplicável + transação + saldo + ledger + outbox em um commit; evento persistido tem ID estável; sem publish dentro da transação. |
| Terminalidade | `PROCESSED`, `REJECTED`, `FAILED` não mudam mais de estado; reidratação não executa transições. Tentativa de mudar terminal é erro de programação. |
| Replay | Preservar status e saldo observado no processamento, incluindo `LOSS`/rejeição; replay altera apenas o indicador `idempotentReplay`. Resultado de pendentes exige contrato posterior explícito. |
| Auditoria/reconciliação | Reconstruir saldo pelo ledger sob snapshot consistente; divergências geram resposta, log e métrica, sem ajuste silencioso. |

PostgreSQL não permite usar um `CHECK` ordinário como garantia entre linhas/tabelas. Unicidade/FKs/checks locais devem estar no banco; invariantes cruzadas exigem o desenho transacional e, quando adotados, triggers específicos testados, sem alegar garantia inexistente. [PostgreSQL: constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)

Transições propostas para a change de transações: `PENDING → PROCESSED | PENDING_REFERENCE | REJECTED | FAILED`; `PENDING_REFERENCE → PROCESSED | REJECTED | FAILED`. Referência ainda ausente mantém `PENDING_REFERENCE` e atualiza apenas metadados de retry; não reemite o mesmo evento indefinidamente. Erro transitório provoca rollback/retry, não `FAILED` imediato. Classificação de falha permanente não pode depender de conseguir escrever no banco durante uma indisponibilidade.

### D7. Concorrência e entrega — diretrizes futuras

Escolher pessimistic row locking (`SELECT ... FOR UPDATE`, exposto por `LockMode`) sob `READ COMMITTED`, dentro de `EntityManager.transactional()`. A unidade de serialização é a wallet; a seção crítica não contém chamadas SQS/HTTP. Ordenar aquisição: wallet → transação de negócio/referência → lançamentos/controle de mensagem; todos os fluxos financeiros obedecem a mesma ordem. Quando duas operações disputam saldo `100.00` com débitos `80.00`, a segunda relê saldo `20.00` após o lock e rejeita sem ledger. Wallets distintas continuam paralelas.

`UNIQUE` arbitra inserts concorrentes de idempotência/inbox/reversão. Conflito que invalida a transação é tratado após rollback em novo contexto; buscar o resultado persistido não pode usar uma transaction abortada. Deadlocks/timeouts podem ter retry limitado da operação inteira; erro de negócio não deve ser tratado como falha transitória. `version` fica como sequência de mudanças de saldo/auditoria, não substitui a estratégia de lock.

Optimistic locking com retry é viável, mas produz mais trabalho desperdiçado em hot wallets; update condicionado isoladamente não resolve inbox/ledger/outbox/referências. `SERIALIZABLE` acrescenta aborts que não são necessários para essa unidade de concorrência. Mutex local e lock global não atendem ao README.

Publisher futuro usa claim por lote com `FOR UPDATE SKIP LOCKED` e lease persistente com expiração/ownership token; commit do claim precede I/O SQS, atualização de publicação verifica ownership. Crash antes de enviar libera trabalho após lease; crash após enviar e antes de marcar pode duplicar. `eventId` estável e inbox downstream tornam redelivery seguro; nenhum mecanismo promete exactly-once no broker. Backoff/cap e recuperação de lease evitam spin/publicação duplicada indefinida. O destino de eventos ainda não é definido pelo README e não será provisionado nesta fundação.

Consumidor futuro compartilha o use case HTTP, faz ack somente depois do commit, ack de rejeição de negócio persistida, retry transitório com backoff e encaminhamento permanente à DLQ com limite. `PENDING_REFERENCE` será persistido e confirmado na fila, liberando o grupo FIFO para a referência chegar; o scheduler SQL assume o retry. Manter a mensagem bloqueando a FIFO poderia impedir a própria referência de ser entregue.

### D8. SQS e parâmetros operacionais — fundação

AWS SDK v3 apontado explicitamente ao LocalStack, com timeout/retry limitados e descoberta de URL por nome. Provisionar DLQ antes da fila principal para obter seu ARN. Valores iniciais de desenvolvimento:

| Atributo | Principal | DLQ |
|---|---|---|
| Nome | `wager-transactions.fifo` | `wager-transactions-dlq.fifo` |
| `FifoQueue` | `true` | `true` |
| `ContentBasedDeduplication` | `false` | `false` |
| `VisibilityTimeout` | 60 s | 60 s |
| `ReceiveMessageWaitTimeSeconds` | 20 s | 20 s |
| `MessageRetentionPeriod` | 345600 s (4 dias) | 1209600 s (14 dias) |
| `RedrivePolicy` | ARN da DLQ; `maxReceiveCount = 5` | Ausente |
| `RedriveAllowPolicy` | Não aplicável | `byQueue`, restrita ao ARN da principal |

60 s de visibility supera o shutdown inicial de 25 s; handlers futuros longos renovarão visibility antes de expirar. SDK receive deve ter timeout superior ao long poll; começar com 25 s. Health usa timeout próprio curto, sem long polling. Os valores são configuráveis/validados, e testes usam filas próprias com visibility menor para não esperar minutos. [AWS: visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)

Envio futuro: `MessageGroupId = walletId`; `MessageDeduplicationId` derivado de identificador lógico estável, sem pressupor duração infinita da dedup do broker. O provisionamento com dedup explícita evita esconder payload divergente por hash automático. Mesmo FIFO admite redelivery; idempotência SQL continua obrigatória. DLQ pode quebrar ordem estrita, por isso referências serão tratadas no domínio. [AWS: FIFO](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/creating-sqs-fifo-queues.html), [AWS: DLQ](https://docs.aws.amazon.com/en_gb/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

O harness exercita `SendMessage`, `ReceiveMessage`, `ChangeMessageVisibility`, `DeleteMessage` e redrive automático em filas isoladas com payload técnico. Isto valida transporte, não implementa inbox, publisher ou retry financeiro. Não adicionar SNS/EventBridge/fila de eventos sem definir primeiro seu consumidor e contrato.

### D9. Health e logs — fundação

API pública, sem autenticação:

- `GET /health/live`: `200 { "status": "ok" }` quando processo atende; não consulta PostgreSQL/SQS.
- `GET /health/ready`: `200 { "status": "ok", "checks": { "postgresql": "up", "sqs": "up" } }` se `SELECT 1`, migrations esperadas e consulta de atributos das duas filas funcionarem.
- Readiness negativa, exemplo de falha PostgreSQL: `503 { "status": "error", "checks": { "postgresql": "down", "sqs": "up" } }`; cada check contém `"up"` ou `"down"` conforme a dependência. Durante draining, adicionar `"reason": "shutting_down"` e responder 503 enquanto o listener existir.

PostgreSQL `down` inclui migration pendente; SQS `down` inclui fila ausente ou atributos FIFO/redrive incompatíveis. Probes não publicam/consomem mensagens nem fazem DDL. Executar checks em paralelo, com orçamento global de 2 s e cancelamento/timeouts dos clientes; evitar retries SDK que excedam o orçamento. Reavaliar cada chamada; após retorno das dependências readiness recupera sem reiniciar aplicação. O cliente pode existir desconectado; estar configurado não significa estar pronto.

Worker não expõe endpoint HTTP. `health:worker` roda probe de dependências com o mesmo contrato operacional, retorna exit code 0/1 e JSON limitado; o estado do processo principal é observado pelo container. O probe não prova progresso de jobs futuros. HTTP da API e comando worker reutilizam as mesmas verificações. Readiness é diagnóstico e não deve gerar um loop de reinícios por falhas externas.

Logs JSON em stdout/stderr com `timestamp`, `level`, `service`, `event` e `correlationId` quando houver request; preservar `x-correlation-id` quando corresponder a `^[A-Za-z0-9._:-]{1,128}$`, caso contrário gerar UUID, e devolvê-lo no header. Campos `messageId`, `transactionId`, `walletId`, `providerId` só quando existirem, sem inventar IDs. Nunca registrar credenciais, connection strings, tokens ou payloads financeiros completos. Métricas de negócio entram com os respectivos fluxos.

### D10. Testes e critérios de evidência — fundação

Bun Test é o único runner. Unitários cobrem configuração e mapeamento de health; integração usa PostgreSQL/LocalStack em containers; smoke inicia a imagem/entrypoints compilados. Não assumir sucesso porque containers estão `running`. O harness espera condições observáveis com timeout, usa nomes/database/filas exclusivos por execução e limpa somente recursos próprios. Falta de Docker, token ou serviço necessário falha com diagnóstico; não fazer skip silencioso.

Fixtures técnicas ficam em `tests/fixtures`, não no schema de produção. Elas permitem provar rollback SQL, isolamento de contextos e pool com concorrência real sem entidades financeiras fictícias. Testes de round-trip de `NUMERIC` retornam strings exatas, incluindo valor com centavos acima do inteiro seguro JS; não instanciam `Money`. Testes de migration destrutiva/DDL usam papel migrator em database descartável, nunca o volume de desenvolvimento.

Matriz desta etapa: build/DI real sob Bun; config inválida; migration `up/up/down/up`; falha de migration atômica; rollback de transação; contextos concorrentes isolados; privilégios separados; provisionamento repetido sem perder mensagem; atributos FIFO/DLQ; send/receive/visibility/redelivery/delete/redrive; liveness/readiness normal/degradada/recuperada; API + ≥3 workers simultâneos; SIGTERM/restart; persistência PostgreSQL. O teste de workers também deixa uma mensagem na fila de negócio e comprova que permanece disponível após encerrar os scaffolds.

**Pendências financeiras obrigatórias, não cobertas por este smoke:** unitários de Money/Wallet/kinds/moeda/hash; migrations e constraints financeiras; atomicidade wallet/ledger/inbox/outbox; 50 envios paralelos da mesma aposta; duas apostas `80.00` para `100.00`; wallets distintas paralelas; ≥3 instâncias aplicando dinheiro; morte após commit antes do ack; dois publishers concorrentes; reversão antes da referência; retry/DLQ e reinício com recuperação. Em todos os cenários financeiros, comparar saldo materializado com reconstrução do ledger, além de contar efeitos/eventos. Resultados desses testes não podem ser marcados como atendidos nesta change.

### Priorização P0/P1 e critérios de conclusão

P0/P1 definem **ordem de implementação**, não níveis de exigência do README. D1–D10, as seis capabilities e todos os requisitos finais permanecem válidos. `tasks.md` contém a execução detalhada; as specs descrevem a fundação completa, somando P0 e P1.

| Marco | Conteúdo e evidência mínima | Quando executar |
|---|---|---|
| P0 — runtime | Build strict; decorators/metadata, DI e imports comprovados com Bun no host e na imagem final; API e worker separados, sem consumo financeiro. | Primeiro, antes de assumir compatibilidade do restante da stack. |
| P0 — persistência | PostgreSQL real, MikroORM com contextos isolados, papéis separados, migration técnica versionada; `up → up → down → up`, rollback SQL e round-trip decimal reais. | Antes de começar a persistência financeira. |
| P0 — operação básica | Compose, provisionamento repetível sem destruição, atributos FIFO/DLQ, send/receive/delete técnico, health público com diagnóstico de falha simples, probe worker, shutdown normal, scripts/testes e documentação mínima. | Fecha a base necessária ao domínio. |
| P1 — robustez SQL | Concorrência entre migrators, timeout/liberação do lock, falha intermediária de DDL, reversão com objetos adicionais e isolamento sob falhas concorrentes. | Após P0 e antes de depender desses cenários operacionais; sempre antes do fechamento. |
| P1 — mensageria | Reconciliação de drift, visibility, redelivery e redrive/DLQ técnicos, inclusive verificação de ausência de consumo pelo scaffold. | Antes de aceitar consumer/retry/DLQ financeiros nas changes correspondentes. |
| P1 — recuperação | Indisponibilidade/latência avançada, draining/timeout de shutdown, API + ≥3 workers, restart de processos/PostgreSQL, persistência e cleanup adversarial. | Antes dos testes financeiros equivalentes e da entrega final. |

O harness oferece seleção explícita `bun run test:infra --scope=p0` para evidência parcial. `bun run test:infra` sem filtro mantém o contrato de suite completa P0+P1. O relatório parcial identifica o escopo e pendências P1; não chama seleção parcial de conformidade completa nem substitui cenários por mocks. Não é necessário acrescentar outro runner, tecnologia ou abstração de testes.

**Saída de P0:** tarefas 1–5 concluídas, comandos básicos reproduzíveis e smoke compilado no Docker aprovado, migrations reversíveis comprovadas em PostgreSQL real e SQS/health básicos testados. Pode-se então iniciar a primeira change financeira. **Fechamento desta change:** todas as tarefas P0 e P1 concluídas, suite completa e seis specs atendidas; manter a change aberta enquanto houver P1. **Entrega do desafio:** acrescentar todos os testes financeiros abaixo e demais requisitos obrigatórios do README. “Quando aplicável” não dispensa um teste obrigatório; adaptação de mecanismo deve conservar cenário e garantia, com rastreabilidade explícita.

### Planejamento futuro e rastreabilidade dos testes financeiros — README §13

Os nomes abaixo são **changes planejadas, ainda não criadas**, sem novos arquivos ou implementação nesta revisão. Cada uma deverá gerar sua própria proposta/specs/tasks antes do apply e resolver as ambiguidades pertinentes em `Open Questions`. A fundação continua sem entidades, tabelas ou endpoints financeiros. A extração abaixo identifica responsáveis; não antecipa um schema completo nem adiciona tecnologias.

| ID | Change futura | Responsabilidade e dependência |
|---|---|---|
| F1 | `implement-money-wallet-ledger` | Money, Wallet, ledger, mapeamento e constraints, abertura e testes de domínio/persistência. Depende de P0. Preparar internamente, sem expor movimentação antes da unidade transacional completa de F2. |
| F2 | `implement-wagering-transactions` | Use case comum, kinds, referências, estados, failure codes, idempotência persistente, snapshots e gravação atômica de saldo/ledger/transação/outbox com envelopes de eventos. Depende de F1. Nenhuma publicação antes de commit; inbox será incorporada em F3. |
| F3 | `implement-sqs-inbox-consumer` | Entrada SQS reutilizando F2, inbox na mesma transação, ack pós-commit, classificação de erros/retry/DLQ, shutdown e redelivery. Depende de F2 e testes de transporte P1. |
| F4 | `implement-outbox-publisher` | Destino e publicação de eventos confirmados, claim/lease, múltiplos publishers e recuperação pós-commit. Depende da outbox/envelopes de F2 e verificações P1 pertinentes. |
| F5 | `implement-reference-reprocessing` | Scheduler persistente de `PENDING_REFERENCE`, backoff/TTL e eventos de expiração. Depende de F2; aceitação fim a fim exige F3/F4 e P1 de recuperação. |
| F6 | `implement-financial-api-reconciliation` | Endpoints financeiros/consultas, contratos HTTP, ponto de extensão de identidade, reconciliação e observabilidade obrigatória. Depende de F1/F2; integração completa usa F3–F5. |
| F7 | `verify-financial-concurrency-recovery` | Reexecução integrada, com processos reais e falhas controladas, da matriz §13; auditoria da consistência final. Depende de F1–F6 e de todo P1. Não é lugar para adiar os testes que cada change proprietária já deve entregar. |

Cada teste pertence à change responsável indicada e deve acompanhá-la desde a implementação do comportamento. F7 consolida a evidência final, sem substituir cobertura local. IDs S13 são estáveis: se uma change for dividida ou renomeada, atualizar o responsável na matriz e nas respectivas tasks, sem perder a obrigação.

| ID | Teste obrigatório do README §13 | Change responsável / integração | Evidência exigida |
|---|---|---|---|
| S13-U01 | Operações e validações de Money, escala, arredondamento e entradas inválidas | F1 | Bun Test com strings exatas, imutabilidade, limites e rejeição de escala inválida sem arredondamento silencioso. |
| S13-U02 | Invariantes da Wallet | F1 | Unicidade na persistência, saldo não negativo, moeda, abertura, versão e correspondência com ledger; transições encapsuladas. |
| S13-U03 | Regras de BET, WIN, LOSS, REFUND e ROLLBACK | F2 | Casos válidos/rejeitados, referências, valores/direções, estados terminais e ausência de ledger quando não há efeito. |
| S13-U04 | Conflito de moeda | F1 e F2 | Operações Money/Wallet e use case rejeitam moedas incompatíveis; BRL único no setup não elimina o teste. |
| S13-U05 | Idempotency key com payload divergente | F2; contrato HTTP em F6 | Mesma key com hash divergente gera conflito, sem replay e sem novo efeito financeiro. |
| S13-I01 | Migrations e constraints | Bootstrap P0/P1 para infraestrutura; F1, F2 e F3 para schema financeiro | PostgreSQL real: up/down, UNIQUE, não-negatividade, imutabilidade do ledger, FKs, idempotência e inbox; SQL direto sob papel de aplicação. Cada migration futura acompanha seu teste. |
| S13-I02 | Atomicidade entre wallet, ledger, inbox e outbox | F2 para unidade inicial; F3 para fechamento com inbox | Falhas antes do commit revertem todos os componentes; sucesso confirma tudo junto; nenhum publish pré-commit. A prova sem inbox em F2 é parcial. |
| S13-I03 | Inbox e redelivery | F3 | Reentrega com mesmo `(consumerName, messageId)` não duplica transação, saldo, ledger ou evento lógico; prova persistente após restart. |
| S13-I04 | Publishers concorrentes sobre a mesma outbox | F4 | Dois publishers disputam eventos reais, sem perda; leases recuperáveis e duplicatas seguras por eventId. |
| S13-I05 | Retry e DLQ | F3; publicação/retry da outbox em F4 | Erro de negócio terminal é confirmado; transitório recebe retry limitado/backoff; permanente segue à DLQ; saldo não duplica. O redrive técnico P1 não substitui essa classificação. |
| S13-I06 | Recuperação após reinicialização | F3, F4 e F5; consolidação F7 | Reinício preserva inbox/resultados/pendências SQL; outbox retoma publicação e referências voltam a ser processadas, com igualdade saldo/ledger. |
| S13-C01 | Mesma aposta enviada 50 vezes em paralelo | F2; repetir por HTTP/SQS em F3/F6 e F7 | 50 envios sobrepostos, uma transação efetiva e um débito; replay do resultado original; duplicações deliberadas não mascaradas pela dedup FIFO. |
| S13-C02 | Duas apostas de 80.00 disputam saldo 100.00 | F2; consolidação F7 | Uma PROCESSED, uma REJECTED por saldo insuficiente, saldo 20.00, exatamente um débito; retries sem efeito adicional. |
| S13-C03 | Wallets distintas em paralelo | F2; consolidação F7 | Operações realmente sobrepostas em conexões/processos independentes; progresso de outra wallet enquanto uma está bloqueada, sem lock global. |
| S13-C04 | Pelo menos três processos/instâncias simultâneos | F3; repetir HTTP em F6 e consolidar F7 | ≥3 processos executando operações financeiras concorrentes contra o mesmo PostgreSQL/SQS; P1 de scaffolds não é evidência financeira. |
| S13-C05 | Worker morto depois do commit e antes do ack | F3; consolidação F7 | Sincronizar no ponto pós-commit/pré-ack, matar o processo, deixar redelivery a outra instância e comprovar um único efeito com resultado persistido. |
| S13-C06 | Dois publishers sobre a mesma outbox | F4; consolidação F7 | Dois processos reais, incluindo crash entre envio e marcação; nenhum evento confirmado perdido e consumidor tolerante a duplicatas. |
| S13-C07 | ROLLBACK ou REFUND antes da referência | F2 para estado inicial; F5 para conclusão via F3/F4 | PENDING_REFERENCE persistido, ack libera FIFO, scheduler retoma após chegada da referência e aplica uma vez; incluir expiração/REJECTED com failureCode e evento. |
| S13-C08 | Reinício com comprovação de consistência final | F7, reutilizando cenários de F3–F5 | Reiniciar serviços com pendências e reentregas; aguardar processamento, reconstruir ledger e comparar saldo, estados, efeitos e eventos finais. |
| S13-G01 | `wallet.balance == saldo reconstruído pelo ledger` | F1–F7 | Asserção comum em todo cenário financeiro com wallet persistida; testes unitários isolados preservam a álgebra/invariantes pertinentes. Nenhum teste de concorrência/falha fica satisfeito apenas por status HTTP ou contagem de mensagens. |

PostgreSQL e SQS reais em containers são obrigatórios nos testes de integração e nos cenários que usam fila; paralelismo real é obrigatório em S13-C01–C08. Testes de falha usam barreiras observáveis no ponto crítico, não mocks sequenciais ou sleeps como prova de ordenação. Todos os IDs permanecem pendentes nesta revisão. O encerramento F7 também verifica os demais requisitos §2–§12/§14, incluindo logs, métricas, health, documentação e extensão de autenticação; a matriz §13 não reduz o restante do desafio.

### Estrutura de pastas proposta

```text
.
├── src/
│   ├── bootstrap/
│   │   ├── api.ts
│   │   └── worker.ts
│   ├── composition/             # módulos raiz NestJS por processo
│   ├── platform/
│   │   ├── config/
│   │   ├── database/
│   │   │   └── migrations/
│   │   ├── messaging/sqs/
│   │   ├── health/
│   │   └── logging/
│   └── modules/                 # módulos financeiros somente em changes futuras
│       ├── wallets/{domain,application,infrastructure,presentation}/
│       └── wagering/{domain,application,infrastructure,presentation}/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── smoke/
│   ├── fixtures/                # somente dados/entidades/migrations técnicas de teste
│   └── support/
├── docker/postgres/             # bootstrap de database/papéis locais
├── scripts/                     # provisionamento, migration, probes e harness
├── openspec/changes/bootstrap-backend-foundation/
│   ├── proposal.md
│   ├── design.md
│   ├── specs/<capability>/spec.md
│   └── tasks.md
├── Dockerfile
├── compose.yaml
├── compose.test.yaml
├── package.json
├── bun.lock
├── bunfig.toml
├── tsconfig.json
├── tsconfig.build.json
├── .env.example
├── .gitignore
├── .dockerignore
├── README.md
└── ARCHITECTURE.md
```

Árvore de destino, não arquivos já existentes. Os diretórios de domínio futuros são convenção documentada; não criar classes vazias para preenchê-los. Código compartilhado técnico vai para `platform`; conceitos financeiros compartilhados só serão extraídos quando houver necessidade concreta.

## Risks / Trade-offs

- [Compatibilidade Bun/NestJS/MikroORM/metadata] → Fixar versões, compilar com TypeScript e executar smoke de DI/migrations sob Bun antes de avançar; não validar apenas typecheck.
- [LocalStack pode exigir token/edição específica; snapshots não equivalem à durabilidade AWS] → Pré-requisitos explícitos, tag fixa e distinção entre restart de aplicação e recriação do emulador; não afirmar zero perda após crash do LocalStack.
- [Prova financeira ainda ausente] → Não atribuir garantias financeiras aos testes de infraestrutura; manter rastreabilidade e changes próprias para schema/use cases/falhas.
- [Hot wallet serializa operações] → Transações curtas, sem rede sob lock, pools limitados; métricas de lock posteriores. É o custo intencional da consistência por wallet.
- [Row locks não resolvem sozinhos idempotência e atomicidade] → Constraints + transação única + inbox/outbox e testes adversariais futuros.
- [Readiness de SQS torna API indisponível mesmo quando SQL funciona] → Seguir contrato explícito do README; otimização de disponibilidade exige decisão posterior, sem enfraquecer este health.
- [Migration `down` futura pode destruir dados] → Rollback técnico aqui apenas em banco descartável/schema vazio, sem `CASCADE`; migrations financeiras exigirão estratégia de preservação/backup própria.
- [Testes de fila são eventualmente consistentes e a dedup FIFO pode esconder falhas] → Polling com deadline, IDs explícitos, filas isoladas e testes de redelivery; não usar apenas contadores aproximados como evidência.
- [Excesso de abstrações consome o timebox] → Composição simples, somente adapters necessários, sem scaffolds financeiros vazios.

## Migration Plan

1. P0: implementar toolchain e processos; comprovar decorators, DI, imports e build sob Bun no host e no Docker.
2. P0: subir dependências isoladas, provisionar papéis e testar migration técnica reversível; provisionar filas sem consumo financeiro.
3. P0: testar integração básica, health e encerramento normal; registrar setup/decisões e evidências do marco. Com P0 aprovado, iniciar F1 mantendo as tarefas P1 abertas.
4. P1: completar testes de migrations concorrentes, transporte sob falhas, múltiplos processos, shutdown adversarial e recuperação antes dos respectivos testes financeiros. Executar suite completa e atualizar README/`ARCHITECTURE.md` preservando o enunciado.
5. Antes da entrega final: concluir todo P1 aplicável e executar a matriz S13 nas changes responsáveis e em F7; fechar esta change somente após P0+P1, sem confundir status de planejamento com implementação concluída.
6. Em falha do deploy local, parar API/worker e corrigir configuração/imagem; não apagar filas/volumes. `down` de migration é comando explícito apenas com schema vazio. `docker compose down` preserva o volume; remoção de volumes é operação destrutiva separada no ambiente de testes. Após existirem migrations financeiras, os testes de reversão da fundação usam banco descartável e o conjunto de migrations técnicas delimitado, sem reverter dados de desenvolvimento.

## Open Questions

As decisões de fundação estão fechadas acima. As ambiguidades abaixo afetam **changes futuras** e devem ser ratificadas antes de especificar/implementar os contratos financeiros; não bloqueiam as specs atuais nem são tarefas ocultas do bootstrap.

| Ambiguidade do README | Direção proposta para revisão posterior | Momento de resolução |
|---|---|---|
| Escopo global ou por provider da `Idempotency-Key`; mesma identidade externa com outra key | Key única por provider, além de `(providerId, externalTransactionId)` único; header é fonte da verdade e não é substituído pelo default recomendado. Outra key para a mesma identidade não cria nova operação. Definir resposta explícita para esse caso. | Change de idempotência/API. |
| Campos/normalização do hash | SHA-256 sobre UTF-8 de JSON canônico com chaves recursivamente ordenadas, lista fechada de campos de negócio (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`, referência quando presente). Excluir key, IDs de transporte, timestamps e correlation. Validar/normalizar Money antes do hash; definir ausência versus `null` e rejeitar campos desconhecidos. | Change de contratos. |
| Escala de entrada: aceitar `"25"`/`"25.0"` ou exigir `"25.00"` | Preferir exigir exatamente duas casas nos contratos; o README combina “escala fixa” e rejeição de “mais de 2”. Não arredondar valores inválidos. | Change de Money. |
| `BET`/`WIN`/reversão com `"0.00"`; amount em `LOSS` | Preferir `BET`/`WIN`/reversão positivos e `LOSS` zero, porque ledger sem mudança e version entram em conflito com tabelas de efeitos; essa restrição adicional ainda precisa ser ratificada. | Change de Money/regras. |
| `WIN` com referência opcional ausente/não processada; `LOSS` referenciado | Referência fornecida deve ser validada no mesmo escopo; definir espera/rejeição para referência presente mas `PENDING`, `REJECTED` ou `FAILED`. Não presumir que “existe” significa aplicável. | Change de referências. |
| Uma reversão por tipo versus uma única reversão total | §7.4 permite limite por tipo; frases “uma única vez” podem sugerir proibir `REFUND` e `ROLLBACK` sobre a mesma `BET`. Ratificar antes do índice de unicidade; não restringir nem permitir silenciosamente combinação ambígua. | Change de reversões. |
| Quantidade de resultados por rodada e efeito de `ROLLBACK` de `REFUND` | O README não estabelece uma máquina de estados da rodada nem regra de reabrir direito de reversão. Não criar unique de rodada ou recursão de reversões sem contrato. | Change de wagering. |
| Replay de `PENDING_REFERENCE` e resposta HTTP síncrona/assíncrona | Preferir tentativa síncrona no use case comum e `202` enquanto pendente; replay terminal devolve snapshot original, pendente evolui para resultado terminal persistido. Distinguir validação `400`, conflito `409`, rejeição `422`, pendência `202`, transitório `503`; definir sucesso e `404` por endpoint. | Change de API/idempotência. |
| TTL/backoff de referência, métricas de tentativas e `FAILED` | Propor TTL 24 h, base 5 s, cap 5 min com jitter e próximo horário persistido; TTL expirado rejeita com `REFERENCE_NOT_FOUND`. Separar tentativas de referência das entregas SQS. `FAILED` exige falha permanente auditável, não mero timeout. | Change de scheduler/falhas. |
| Taxonomia completa de `failureCode` | Reservar distinção `INSUFFICIENT_FUNDS` versus `REVERSAL_INSUFFICIENT_FUNDS`; exemplos adicionais `REFERENCE_NOT_FOUND`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_NOT_PROCESSED`, `REVERSAL_ALREADY_APPLIED`, `CURRENCY_MISMATCH`. Não fechar lista incompleta como contrato final. | Change de domínio/contratos. |
| Destino dos eventos e consumidores downstream | Definir transporte/fila dedicada e contratos de dedup por `eventId`; nunca enviar integração para `wager-transactions.fifo` automaticamente. | Change de outbox. |
| Eventos de `OPENING`, formato do cursor e limites monetários | Formalizar emissão na abertura, cursor ordenado por sequência imutável da wallet e precisão máxima como contratos; o README não fixa detalhes suficientes. | Changes de wallets/consulta/eventos. |

As fontes técnicas externas sustentam comportamento de ferramentas; não alteram requisitos do README. Não foram executados builds, containers ou testes da aplicação durante esta proposta.
