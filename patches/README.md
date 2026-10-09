# Compatibilidade de tipos

Patches declarados em `package.json` e fixados em `bun.lock`, aplicados por Bun também com `--frozen-lockfile`. Nenhum JavaScript de dependência foi alterado e nenhuma versão foi substituída.

- `@mikro-orm/core@7.2.4`: `CleanTypeConfig<T>` mantém a restrição `TypeConfig` por interseção explícita. Corrige TS2344 nas declarações de `serialize` com TypeScript 5.9.3 e `exactOptionalPropertyTypes: true`.
- `postgres-interval@4.1.0`: retorno de `toTemporalDuration()` tratado conservadoramente como `unknown`, pois a assinatura original exige tipos globais `Temporal` que não existem no lib ES2022/TypeScript 5.9.3. A aplicação não utiliza esse método nem intervalos; não instalar um polyfill de runtime para uma API não utilizada. Antes de usar essa API, fornecer tipos Temporal completos e rever o patch.

Reavaliar os dois patches em futura atualização das dependências. `strict`, `exactOptionalPropertyTypes` e verificação de declarações (`skipLibCheck: false`) permanecem habilitados.
