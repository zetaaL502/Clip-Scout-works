FROM node:22-slim
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN rm pnpm-lock.yaml
RUN pnpm install --no-frozen-lockfile
CMD ["pnpm", "run", "start"]
