# Utsavora API — multi-stage build. Context: repository root.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @utsavora/api...
RUN pnpm --filter @utsavora/types --filter @utsavora/validation build \
 && pnpm --filter @utsavora/api build \
 && pnpm --filter @utsavora/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist && cp -r apps/api/migrations /out/migrations

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. Migrations are idempotent and run in a transaction.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
