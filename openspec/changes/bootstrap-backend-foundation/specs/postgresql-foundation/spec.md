# Spec Delta

## Purpose

Estabelecer conectividade PostgreSQL, permissões de execução, isolamento de operações concorrentes e migrations reversíveis, sem antecipar o schema financeiro do desafio.

## ADDED Requirements

### Requirement: Migration técnica versionada e reversível

Os comandos `bun run db:migrate`, `bun run db:rollback` e `bun run db:status` MUST operar sobre migrations versionadas, com aplicação e reversão explícitas. A primeira migration SHALL criar somente o schema técnico `wagering` e suas permissões; o histórico SHALL permanecer fora do schema revertido. A reversão MUST falhar se o schema contiver objetos não previstos, sem remoção em cascata. Nenhuma tabela financeira ou fixture de testes SHALL integrar essa migration.

#### Scenario: Ciclo completo em banco vazio

- **WHEN** o operador executa `db:migrate`, novamente `db:migrate`, `db:rollback` e `db:migrate` em um banco descartável
- **THEN** o schema é criado uma única vez, removido sem objetos residuais próprios e recriado, com status/histórico coerentes a cada etapa

#### Scenario: Reversão encontra objetos adicionais

- **WHEN** o schema técnico contém um objeto adicional e a migration inicial é revertida
- **THEN** a reversão falha preservando esse objeto, sem usar remoção em cascata

### Requirement: Migrations atômicas e exclusivas

Uma falha de migration MUST reverter seus efeitos e impedir registro de sucesso. Execuções concorrentes de migrations MUST ser serializadas com prazo limitado de espera, sem aplicar o mesmo passo duas vezes. Iniciar API/worker MUST NOT modificar o schema nem aplicar pendências automaticamente.

#### Scenario: Falha após primeiro DDL

- **WHEN** uma migration técnica de teste executa um DDL e falha antes de concluir
- **THEN** o DDL é revertido, a migration não consta como aplicada e o comando retorna código não zero

#### Scenario: Dois migrators

- **WHEN** dois comandos de migration disputam o mesmo banco
- **THEN** somente um altera o schema por vez, e o segundo observa o resultado concluído ou falha por timeout explícito sem corrupção do histórico

### Requirement: Isolamento de operações e rollback

Operações concorrentes MUST usar contextos de persistência independentes, sem compartilhar entidades mutáveis ou transações. Uma unidade de trabalho que falha MUST reverter todas as suas gravações; a seguinte MUST iniciar em estado limpo. O banco MUST manter representação decimal exata em round-trip técnico, sem converter valores monetários em ponto flutuante.

#### Scenario: Rollback e contexto limpo

- **WHEN** uma operação grava uma fixture e falha, enquanto outra operação independente é executada
- **THEN** nenhuma escrita da operação com falha fica persistida e a operação independente não recebe estado não confirmado da primeira

#### Scenario: Decimal acima do inteiro seguro

- **WHEN** uma fixture grava `"900719925474099.91"` em uma coluna `NUMERIC(20,2)` e a lê pela integração de persistência
- **THEN** o valor retorna exatamente como string decimal `"900719925474099.91"`, sem perda de centavos

### Requirement: Papéis de banco com responsabilidades distintas

A credencial de API/worker MUST ter acesso ao schema preparado sem propriedade ou permissão DDL. A credencial de migration MUST estar restrita ao comando/job migrator e aos testes que a exigem. Credenciais MUST NOT aparecer em logs ou arquivos versionados de ambiente real.

#### Scenario: Processo tenta criar tabela

- **WHEN** uma conexão usando o papel da aplicação tenta criar ou remover uma tabela no schema da aplicação
- **THEN** PostgreSQL nega a operação, enquanto o migrator autorizado consegue executar sua migration
