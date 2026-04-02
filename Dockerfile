FROM node:20-slim AS base

RUN npm install -g pnpm@10.26.1

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --filter @workspace/api-server... 2>/dev/null || \
    pnpm install --no-frozen-lockfile --filter @workspace/api-server...

RUN pnpm --filter @workspace/api-server run build

FROM node:20-slim AS runner

WORKDIR /app

COPY --from=base /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
