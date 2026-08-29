# ==========================================
# 1. Build Stage
# ==========================================
FROM node:22-slim AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy root configuration files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nest-cli.json tsconfig*.json ./

# Copy shared libraries and microservices
COPY libs ./libs
COPY apps/social-poster ./apps/social-poster

# Install all dependencies and compile social-poster
RUN pnpm install --frozen-lockfile
RUN pnpm run build social-poster

# ==========================================
# 2. Production Runtime Stage
# ==========================================
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install TrueType fonts so Canvas renders text beautifully
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests and install production-only dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy compiled artifacts and static assets (official logo)
COPY --from=builder /app/dist ./dist
COPY apps/social-poster/assets ./apps/social-poster/assets

# Run as non-root node user for container security
USER node

EXPOSE 3001

CMD ["node", "dist/apps/social-poster/main"]
