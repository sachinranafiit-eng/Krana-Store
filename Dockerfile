FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
COPY server-src/package.json server-src/pnpm-lock.yaml server-src/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server-src/ ./
RUN pnpm build && mkdir -p data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
EXPOSE 4173
CMD ["node","backend/src/server.js"]
