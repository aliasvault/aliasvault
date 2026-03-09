FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root files needed for install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy this service and its workspace dependencies
COPY services/smtp-bridge/ ./services/smtp-bridge/
COPY packages/blockchain/contract/ ./packages/blockchain/contract/
COPY shared/ ./shared/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @aliasvault/smtp-bridge...

# Build
RUN pnpm --filter @aliasvault/smtp-bridge build

# --- Production image ---
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/services/smtp-bridge/package.json ./services/smtp-bridge/
COPY --from=builder /app/services/smtp-bridge/dist/ ./services/smtp-bridge/dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/services/smtp-bridge/node_modules/ ./services/smtp-bridge/node_modules/

WORKDIR /app/services/smtp-bridge

EXPOSE 3000

CMD ["node", "dist/index.js"]
