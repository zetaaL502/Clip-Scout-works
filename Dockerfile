FROM node:20-slim AS base

RUN apt-get update && apt-get install -y ffmpeg --no-install-recommends && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.26.1

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/clipscout/ ./artifacts/clipscout/

RUN pnpm install --frozen-lockfile --filter @workspace/api-server... --filter @workspace/clipscout...

RUN pnpm --filter @workspace/clipscout run build

RUN pnpm --filter @workspace/api-server run build

FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y ffmpeg --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=base /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=base /app/artifacts/clipscout/dist ./artifacts/clipscout/dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
