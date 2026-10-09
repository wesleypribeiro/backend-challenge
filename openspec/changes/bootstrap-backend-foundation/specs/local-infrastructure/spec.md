# Spec Delta

## Purpose

Disponibilizar um ambiente local isolável que inicialize dependências e processos na ordem correta, mantenha os dados PostgreSQL e permita reproduzir o setup do desafio.

## ADDED Requirements

### Requirement: Inicialização completa e ordenada

Com os pré-requisitos documentados e configuração válida, `docker compose up --build -d` MUST disponibilizar PostgreSQL, LocalStack, provisionamento, migrations, API e worker. API/worker MUST aguardar sucesso dos jobs de provisionamento e migration; um container apenas iniciado não SHALL ser tratado como dependência pronta. Imagens MUST ter versões fixadas, sem tags `latest`.

#### Scenario: Primeiro startup

- **WHEN** o ambiente é iniciado sem volumes ou filas anteriores
- **THEN** as dependências tornam-se disponíveis, jobs terminam com código zero e API/worker alcançam readiness somente após schema e filas estarem preparados

#### Scenario: Preparação falha

- **WHEN** o job de migration ou provisionamento falha
- **THEN** o ambiente não inicia API/worker como prontos e preserva um diagnóstico que identifica o job com falha

### Requirement: Provisionamento repetível e não destrutivo

Executar novamente a preparação MUST preservar recursos e mensagens existentes. Diferenças corrigíveis nos atributos das filas SHALL ser reconciliadas e verificadas; incompatibilidades que exigiriam recriação SHALL falhar explicitamente. API/worker MUST NOT executar migrations ou provisionamento como efeito colateral de seu startup.

#### Scenario: Repetição com dados existentes

- **WHEN** filas já provisionadas contêm uma mensagem e o job é executado novamente
- **THEN** o job termina com sucesso, as mesmas filas permanecem acessíveis e a mensagem não é perdida

#### Scenario: Recurso incompatível

- **WHEN** o provisionador encontra configuração incompatível que exigiria destruir um recurso
- **THEN** informa o conflito e termina com código não zero, sem apagar ou recriar o recurso

### Requirement: Isolamento de ambiente e replicação de workers

O ambiente MUST permitir execução da API e de pelo menos três workers sem conflitos de nome, porta ou estado de processo. Testes MUST usar projeto Compose e recursos isolados do desenvolvimento. Endpoints documentados para host e containers MUST alcançar as mesmas dependências locais.

#### Scenario: Três réplicas

- **WHEN** o ambiente é iniciado com `docker compose up --build -d --scale worker=3`
- **THEN** uma API e três workers permanecem ativos com acesso às dependências e sem conflitos de portas públicas de worker

#### Scenario: Testes ao lado do desenvolvimento

- **WHEN** um ambiente de testes é criado enquanto o ambiente de desenvolvimento existe
- **THEN** seus databases, filas, portas e volumes não colidem e a limpeza dos testes não remove recursos de desenvolvimento

### Requirement: Persistência e pré-requisitos explícitos

Reiniciar PostgreSQL com seu volume preservado MUST manter dados e histórico de migrations. Reiniciar API/worker MUST preservar dados e mensagens nas dependências em execução. O setup MUST documentar Bun, Docker Compose, configuração e requisitos da versão LocalStack fixada, incluindo token quando necessário, e MUST distinguir a persistência PostgreSQL da possível perda de mensagens ao recriar o emulador.

#### Scenario: Restart de PostgreSQL

- **WHEN** PostgreSQL é reiniciado preservando seu volume após uma fixture técnica ter sido confirmada
- **THEN** a fixture e o histórico de migrations permanecem íntegros e a aplicação recupera readiness

#### Scenario: Pré-requisito de LocalStack ausente

- **WHEN** a versão fixada exige token de ativação e ele não foi configurado
- **THEN** a preparação informa o pré-requisito ausente sem expor tokens e sem declarar a infraestrutura pronta
