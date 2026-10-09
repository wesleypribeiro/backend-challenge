# Spec Delta

## Purpose

Oferecer comandos reproduzíveis para construir, configurar, executar e encerrar os processos independentes do backend, preparando sua evolução modular sem ativar processamento financeiro.

## ADDED Requirements

### Requirement: Toolchain reproduzível sob Bun

O projeto MUST permitir instalação com lockfile congelado, typecheck estrito, build e execução dos processos usando Bun 1.x, sem exigir outro runtime JavaScript ou outro test runner. As versões efetivamente utilizadas MUST estar fixadas e documentadas. Os comandos públicos SHALL incluir `bun run typecheck`, `bun run build`, `bun run start:api` e `bun run start:worker`.

O aceite de runtime MUST executar o build compilado no host e na imagem Docker final com Bun, verificando funcionamento de decorators, dependency injection, registro de rotas e imports. Typecheck, inspeção de arquivos emitidos ou execução direta das fontes TypeScript MUST NOT substituir essa evidência.

#### Scenario: Instalação e build limpos

- **WHEN** um desenvolvedor instala dependências com `bun install --frozen-lockfile` em um checkout limpo e executa typecheck e build
- **THEN** os comandos terminam com sucesso, não alteram o lockfile e produzem entrypoints executáveis sob a versão Bun 1.x documentada

#### Scenario: Erro de tipagem

- **WHEN** o typecheck encontra uma violação de TypeScript strict em código incluído no projeto
- **THEN** o comando retorna código não zero, mesmo que o runtime pudesse transpilar o arquivo

#### Scenario: Build compilado resolve decorators e dependências no Bun

- **WHEN** o smoke inicia API e worker a partir dos entrypoints JavaScript de um build limpo com a versão Bun fixada
- **THEN** as dependências técnicas são resolvidas por injeção de construtor com metadata presente, os imports compilados carregam e a API atende as rotas de health registradas pelos decorators; falha em qualquer etapa reprova o smoke

#### Scenario: Imagem final executa o mesmo build

- **WHEN** a imagem final é executada com configuração válida e dependências disponíveis, sem bind mount de fontes ou fallback para `src/`
- **THEN** API e worker iniciam sob Bun 1.x usando o build compilado, health/probe funcionam e os comandos de migration compilados operam contra PostgreSQL real, sem depender de Node no host

### Requirement: API e worker independentes e sem processamento financeiro

A API e o worker MUST ser processos iniciáveis e encerráveis independentemente a partir do mesmo build. A API SHALL expor somente os endpoints de health desta change. O worker MUST permanecer disponível para lifecycle e probes sem expor uma API financeira ou consumir, confirmar ou publicar mensagens de negócio.

#### Scenario: Worker não remove apostas ainda não suportadas

- **WHEN** uma mensagem está disponível em `wager-transactions.fifo` e três processos worker da fundação são iniciados e encerrados
- **THEN** a mensagem permanece disponível, sem recebimento ou confirmação pelos workers, e nenhum efeito financeiro é criado

#### Scenario: Processos independentes

- **WHEN** a API é encerrada enquanto um worker está em execução
- **THEN** o worker continua vivo e pode ser encerrado separadamente, sem depender do listener HTTP da API

### Requirement: Configuração validada e falhas distinguíveis

Cada processo MUST validar as variáveis necessárias ao seu papel antes de aceitar trabalho. Configuração inválida MUST resultar em exit code não zero e diagnóstico sem segredos. No perfil local, endpoint/região/credenciais SQS MUST ser explícitos e não permitir fallback silencioso para AWS real. Dependência temporariamente indisponível com configuração válida MUST ser distinguida de configuração inválida e permitir readiness negativa sem encerrar repetidamente um processo já iniciado.

#### Scenario: Endpoint local ausente

- **WHEN** a API ou worker é iniciado no perfil local sem `AWS_ENDPOINT_URL`
- **THEN** o processo falha antes de aceitar trabalho, identifica a variável ausente e não tenta acessar um endpoint AWS real

#### Scenario: Dependência indisponível com configuração válida

- **WHEN** o processo é iniciado diretamente com configuração válida e PostgreSQL ou SQS inacessível
- **THEN** o processo permanece vivo, informa indisponibilidade via readiness/probe e consegue recuperar quando a dependência retorna

### Requirement: Encerramento limitado e observável

Os processos MUST tratar `SIGTERM` e `SIGINT`, impedir novo trabalho, liberar conexões e terminar em até 25 segundos na configuração padrão. Encerramento normal SHALL retornar zero; falha ou esgotamento do prazo SHALL ser diagnosticado com saída não zero. A API MUST sinalizar draining na readiness enquanto seu listener ainda responder.

#### Scenario: Encerramento normal

- **WHEN** API e worker recebem `SIGTERM` com dependências saudáveis
- **THEN** ambos liberam recursos e encerram dentro do prazo, sem depender de encerramento forçado do container

### Requirement: Logs estruturados sem dados sensíveis

Os processos MUST emitir logs JSON de startup, falhas, health degradada e shutdown com contexto de processo. Requests HTTP SHALL receber um `x-correlation-id` válido, preservado quando aceitável ou gerado caso ausente/inválido, e esse valor SHALL correlacionar resposta e logs da requisição. Logs MUST NOT conter credenciais, tokens, connection strings ou payloads financeiros completos.

#### Scenario: Falha de conexão

- **WHEN** ocorre erro de conexão usando uma URL com senha e uma requisição com correlation ID válido
- **THEN** o diagnóstico JSON identifica serviço, evento e correlation ID sem registrar a URL completa ou senha
