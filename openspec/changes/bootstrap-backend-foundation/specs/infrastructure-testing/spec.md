# Spec Delta

## Purpose

Fornecer evidências repetíveis sobre a fundação usando Bun Test e serviços reais em containers, separando conectividade e lifecycle das garantias financeiras ainda não implementadas.

## ADDED Requirements

### Requirement: Suites executáveis e serviços reais

O projeto MUST oferecer `bun run test:unit`, `bun run test:integration`, `bun run test:smoke` e `bun run test:infra`, todos com Bun Test. `test:infra` SHALL preparar, executar e limpar a suite de infraestrutura e MUST incluir PostgreSQL e LocalStack reais. Ausência de serviços/pré-requisitos MUST falhar com diagnóstico, sem substituir silenciosamente serviços por mocks ou marcar testes obrigatórios como skipped.

A seleção `bun run test:infra --scope=p0` SHALL permitir verificar explicitamente o marco parcial, incluindo build compilado no Bun/Docker e migrations reversíveis em PostgreSQL real. O relatório MUST identificar o escopo P0 e que a conclusão de P1 ainda deve ser verificada. Sem filtro, `test:infra` MUST abranger P0 e P1; uma execução parcial MUST NOT ser apresentada como conformidade com todas as specs ou com os testes financeiros do README.

#### Scenario: Ambiente de teste limpo

- **WHEN** `bun run test:infra` é executado com pré-requisitos disponíveis
- **THEN** o comando prepara recursos isolados, executa integrações reais e smoke do build, relata resultados e limpa somente recursos próprios

#### Scenario: Docker indisponível

- **WHEN** a suite de infraestrutura é executada sem Docker acessível
- **THEN** retorna código não zero identificando o pré-requisito, sem relatar sucesso parcial como suite concluída

#### Scenario: Marco P0 explicitamente selecionado

- **WHEN** `bun run test:infra --scope=p0` conclui com sucesso e ainda há tarefas P1 pendentes
- **THEN** o relatório identifica somente o marco P0 como aprovado, sem marcar os cenários P1 como executados nem declarar a change concluída

#### Scenario: Validação completa sem filtro

- **WHEN** `bun run test:infra` é usado como evidência de conclusão da fundação
- **THEN** a execução inclui os cenários P0 e P1 especificados; um cenário obrigatório ausente, não executado ou falhando impede declarar essa conclusão

### Requirement: Evidência de persistência e transporte

A suite MUST verificar o ciclo reversível/idempotente de migrations, falha atômica de migration, concorrência entre migrators, separação de privilégios, rollback transacional, contextos concorrentes isolados e round-trip decimal exato. MUST também verificar atributos e reprovisionamento SQS preservando mensagens, envio/recebimento, visibility, redelivery, confirmação e redrive até DLQ. Fixtures técnicas MUST estar restritas ao ambiente de testes.

#### Scenario: Execução com evidências observáveis

- **WHEN** a suite conclui os cenários PostgreSQL e SQS
- **THEN** suas asserções consultam efeitos reais no banco e mensagens realmente recebidas das filas, incluindo DLQ, sem usar apenas mocks ou contadores aproximados

### Requirement: Evidência de lifecycle e múltiplos processos

A suite MUST iniciar a API e pelo menos três processos worker independentes simultaneamente, verificar liveness/readiness/probe, shutdown, restart e recuperação após falha de dependências. MUST verificar preservação PostgreSQL após restart com volume e ausência de consumo financeiro pelos workers da fundação. Corrotinas ou chamadas sequenciais dentro de um único processo MUST NOT substituir esse cenário.

#### Scenario: Três workers e restart

- **WHEN** API e três workers estão ativos e um worker é encerrado e reiniciado
- **THEN** os demais permanecem vivos, o novo processo alcança estado saudável e fixtures/mensagens existentes nas dependências são preservadas

#### Scenario: Falha e recuperação de dependências

- **WHEN** PostgreSQL e LocalStack ficam inacessíveis em cenários separados e depois retornam
- **THEN** liveness da API continua 200, readiness/probe sinalizam a falha dentro do prazo e recuperam sem restart da aplicação

### Requirement: Determinismo, isolamento e alcance explícito

Testes MUST usar recursos exclusivos por execução, polling com deadline e limpeza em sucesso/falha sem afetar desenvolvimento. Documentação MUST distinguir testes de infraestrutura dos testes financeiros pendentes e não afirmar que ausência de duplicação, atomicidade wallet/ledger/inbox/outbox ou consistência final do ledger já foram comprovadas.

#### Scenario: Suite repetida e falha intermediária

- **WHEN** a suite é executada duas vezes e uma execução é interrompida por falha de teste
- **THEN** recursos próprios são limpos ou identificados para limpeza restrita, execuções seguintes não dependem de resíduos anteriores e dados de desenvolvimento permanecem intactos
