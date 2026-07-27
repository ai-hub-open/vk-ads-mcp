# VK Ads MCP (Bun + TypeScript) — HTTP transport
# Zero runtime dependencies → node_modules не нужны.

FROM oven/bun:1.3-alpine
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${MCP_PORT}/healthz || exit 1

CMD ["bun", "run", "src/index.ts"]
