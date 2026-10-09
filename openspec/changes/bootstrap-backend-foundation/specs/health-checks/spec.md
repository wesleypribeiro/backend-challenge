# Spec Delta

## Purpose

Permitir distinguir processo vivo de processo pronto para operar com PostgreSQL e SQS, por contratos públicos e probes limitados que não alteram dados ou mensagens.

## ADDED Requirements

### Requirement: Liveness pública e independente

`GET /health/live` MUST ser público e retornar HTTP 200 com `{ "status": "ok" }` enquanto a API conseguir atender, sem consultar PostgreSQL ou SQS. Falha de dependência MUST NOT transformar liveness em readiness.

#### Scenario: Dependências indisponíveis

- **WHEN** PostgreSQL e SQS estão indisponíveis e o processo HTTP está vivo
- **THEN** uma chamada sem credenciais a `/health/live` recebe 200 e `{ "status": "ok" }`

### Requirement: Readiness verifica dependências e preparação

`GET /health/ready` MUST ser público e retornar 200 com `{ "status": "ok", "checks": { "postgresql": "up", "sqs": "up" } }` somente quando PostgreSQL aceitar consulta, migrations esperadas estiverem aplicadas e ambas as filas SQS estiverem acessíveis com FIFO/redrive compatíveis. Caso contrário MUST retornar 503 com `status: "error"` e cada check como `"up"` ou `"down"`, identificando a dependência afetada.

#### Scenario: Tudo preparado

- **WHEN** banco, migrations, principal e DLQ estão disponíveis/configurados e `/health/ready` é chamado sem autenticação
- **THEN** a resposta é 200 com os dois checks `"up"`

#### Scenario: Banco indisponível ou migration pendente

- **WHEN** PostgreSQL não responde ou a migration esperada não está aplicada, com SQS saudável
- **THEN** a resposta é 503 com `postgresql: "down"` e `sqs: "up"`

#### Scenario: Fila ausente ou incompatível

- **WHEN** SQS não responde, uma das filas está ausente ou sua configuração FIFO/redrive diverge do contrato, com banco preparado
- **THEN** a resposta é 503 com `postgresql: "up"` e `sqs: "down"`

#### Scenario: Recuperação sem restart

- **WHEN** a dependência degradada volta a responder com preparação válida
- **THEN** uma nova chamada retorna 200 sem exigir restart da API

### Requirement: Probes limitados e sem efeitos colaterais

A readiness MUST terminar em até 2 segundos na configuração padrão, inclusive diante de dependência lenta. Probes MUST NOT criar/alterar schema, enviar/receber/excluir mensagens ou expor stack traces, credenciais e URLs internas. Em draining, readiness MUST retornar 503 com `reason: "shutting_down"` enquanto o listener estiver disponível.

#### Scenario: Dependência não responde

- **WHEN** a conexão a uma dependência fica pendente sem resposta
- **THEN** `/health/ready` termina dentro do orçamento com 503 e check afetado `"down"`, sem deixar operações ilimitadas em background

#### Scenario: Mensagem disponível durante probe

- **WHEN** health é consultado repetidamente com uma mensagem disponível na principal
- **THEN** o probe não altera disponibilidade, corpo ou contagem de recebimentos dessa mensagem

### Requirement: Probe independente para workers

`bun run health:worker` MUST avaliar PostgreSQL/migrations e SQS/filas com os mesmos critérios e prazo da readiness, emitir JSON limitado e retornar exit code 0 quando saudável e não zero quando degradado. O comando MUST funcionar sem endpoint HTTP de worker e sem receber mensagens.

#### Scenario: Worker com SQS indisponível

- **WHEN** o probe é executado com PostgreSQL preparado e SQS indisponível
- **THEN** ele termina dentro do prazo com exit code não zero e `sqs: "down"`, sem afirmar que o processo principal morreu
