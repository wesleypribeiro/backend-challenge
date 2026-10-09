# Spec Delta

## Purpose

Preparar as filas SQS FIFO e DLQ exigidas pelo desafio, com configuração verificável e conectividade local, sem ativar o consumidor de transações financeiras.

## ADDED Requirements

### Requirement: Topologia FIFO e DLQ verificável

O provisionamento MUST disponibilizar `wager-transactions.fifo` e `wager-transactions-dlq.fifo` como FIFO com `ContentBasedDeduplication=false`. Na configuração padrão, ambas SHALL ter visibility timeout de 60 segundos e long polling de 20 segundos; retenção SHALL ser 4 dias na principal e 14 dias na DLQ. A principal MUST usar `RedrivePolicy` para a DLQ com `maxReceiveCount=5`, e a DLQ MUST aceitar redrive apenas da principal.

#### Scenario: Atributos após provisionamento

- **WHEN** os atributos das duas filas são consultados após `bun run infra:provision`
- **THEN** nomes, tipo FIFO, dedup explícita, retenção, visibility, long polling e políticas de redrive correspondem ao contrato, usando ARNs reais do ambiente

### Requirement: Conexão local explícita e URLs resolvidas

O acesso SQS no perfil local MUST usar endpoint explícito do LocalStack, região e credenciais fictícias documentadas. URLs/ARNs MUST ser resolvidos do ambiente e funcionar tanto para comandos no host quanto para processos dentro dos containers, sem depender de account ID ou hostname codificado.

#### Scenario: Acesso nos dois ambientes

- **WHEN** um comando no host e um processo em container consultam as filas pelo endpoint apropriado a cada ambiente
- **THEN** ambos encontram as filas provisionadas e consultam seus atributos sem acessar AWS real

### Requirement: Transporte com redelivery e confirmação explícita

O transporte preparado MUST permitir enviar e receber mensagens FIFO, alterar sua visibilidade e confirmá-las explicitamente. Recebimento sem confirmação MUST permitir redelivery após expiração/devolução da visibilidade. Deduplicação FIFO MUST NOT ser apresentada como idempotência financeira. Nesta change, essas operações SHALL ser exercitadas somente pelo harness em filas técnicas isoladas.

#### Scenario: Redelivery sem confirmação

- **WHEN** uma mensagem técnica é recebida e sua visibilidade é devolvida sem confirmação
- **THEN** a mesma mensagem lógica torna-se recebível novamente; após confirmação por receipt handle válido ela deixa de ser entregue

#### Scenario: Visibilidade em execução controlada

- **WHEN** uma mensagem técnica é recebida em uma fila isolada do LocalStack, sem falhas injetadas, e sua visibilidade é estendida
- **THEN** leituras do harness verificam sua indisponibilidade durante a janela e seu retorno após expiração; esse teste não estabelece garantia de entrega exatamente uma vez

### Requirement: Redrive limitado e sem consumo de negócio

Mensagens técnicas não confirmadas MUST alcançar a DLQ conforme o limite de recebimentos configurado. O harness SHALL permitir reduzir esse limite e visibility em filas exclusivas de teste sem alterar a configuração de desenvolvimento. O bootstrap MUST NOT iniciar consumidor financeiro ou excluir mensagens da fila principal de negócio.

#### Scenario: Mensagem excede tentativas

- **WHEN** uma mensagem de teste é recebida repetidamente sem confirmação até exceder a política de redrive
- **THEN** ela torna-se recebível na DLQ correspondente e deixa de ser recebida na principal, dentro do deadline do teste
