# Voice gateway + background worker. Build from the repository root:
#   docker build -f apps/voice-gateway/Dockerfile -t voice-gateway .
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/db/package.json packages/db/
COPY apps/voice-gateway/package.json apps/voice-gateway/
RUN pnpm install --frozen-lockfile --filter @vp/voice-gateway...

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY packages/core packages/core
COPY packages/server packages/server
COPY apps/voice-gateway apps/voice-gateway
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/voice-gateway/src/main.ts"]
