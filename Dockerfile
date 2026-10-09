FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock bunfig.toml .bun-version ./
COPY patches ./patches
RUN test "$(bun --version)" = "$(cat .bun-version)" \
    && bun install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY scripts/build.ts ./scripts/build.ts
COPY src ./src
RUN bun run build && find dist -name '*.map' -delete

FROM base AS production-dependencies
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun package.json ./package.json
USER bun
EXPOSE 3000
ENTRYPOINT ["bun", "--no-env-file"]
CMD ["dist/bootstrap/api.js"]
