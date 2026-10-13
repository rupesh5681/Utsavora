# Utsavora web apps (customer-web | vendor-portal | admin-portal). Context: repository root.
#   docker build -f infrastructure/docker/web.Dockerfile --build-arg APP=customer-web .
ARG APP=customer-web
FROM node:22-bookworm-slim AS build
ARG APP
# Next.js bakes rewrites in at build time: this is where the app's server proxies /api/*.
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_VENDOR_PORTAL_URL=http://localhost:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_PUBLIC_VENDOR_PORTAL_URL=${NEXT_PUBLIC_VENDOR_PORTAL_URL}
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/${APP} ./apps/${APP}
RUN pnpm install --frozen-lockfile --filter @utsavora/${APP}...
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @utsavora/types --filter @utsavora/validation --filter @utsavora/api-client build \
 && pnpm --filter @utsavora/${APP} build

FROM node:22-bookworm-slim
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 APP=${APP}
WORKDIR /app
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build /repo/apps/${APP}/public ./apps/${APP}/public
USER node
EXPOSE 3000
CMD ["sh", "-c", "node apps/$APP/server.js"]
