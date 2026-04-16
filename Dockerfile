# ═══════════════════════════════════════════════════════════════════
#  Stage 1 — Builder
#  Installs ALL deps, builds frontend (Vite), bundles backend (esbuild).
#  Output:
#    dist/          → Vite-built frontend (HTML, JS, CSS, assets)
#    dist/server/   → esbuild-bundled backend (single ESM .js)
# ═══════════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first — Docker caches this layer unless deps change
COPY package*.json .npmrc ./

# Install ALL deps (devDeps required for Vite + esbuild)
RUN npm ci --legacy-peer-deps --no-fund --no-audit

# Copy full source
COPY . .

# 1. Build frontend assets → dist/
RUN npm run build

# 2. Bundle backend TypeScript → dist/server/index.js
#    --bundle:            inline all local TS imports into one file
#    --packages=external: keep npm packages as require() calls
#    --format=esm:        output ES modules (matches "type":"module")
#    --platform=node:     enables Node.js built-ins (fs, path, crypto …)
#    --target=node20:     allows modern JS syntax, matches runtime
RUN node_modules/.bin/esbuild backend/src/server.ts \
      --bundle \
      --platform=node \
      --target=node20 \
      --format=esm \
      --packages=external \
      --outfile=dist/server/index.js


# ═══════════════════════════════════════════════════════════════════
#  Stage 2 — Runner
#  Lean production image — no devDeps, no source files, no tsx.
#  Includes:
#    node_modules/  → production deps only
#    dist/          → frontend static files + bundled backend
#    seed.sql       → baseline data seed (run once after first deploy)
#    uploads/       → persistent file attachments (Docker volume mount)
# ═══════════════════════════════════════════════════════════════════
FROM node:20-alpine AS runner

WORKDIR /app

# dumb-init:         proper PID 1 — forwards signals to Node, prevents zombie processes
# tzdata:            correct timestamps in logs / date fields (Asia/Riyadh)
# postgresql-client: run seed.sql from inside the container
RUN apk add --no-cache dumb-init tzdata postgresql-client

# Copy manifests
COPY package*.json .npmrc ./

# Install PRODUCTION dependencies only (no tsx, typescript, @types/*, drizzle-kit)
RUN npm ci --legacy-peer-deps --omit=dev --no-fund --no-audit

# Copy built output from builder stage
COPY --from=builder /app/dist ./dist

# Baseline seed — idempotent, run once after first deploy:
#   docker compose exec app sh -c "psql \$DATABASE_URL -f /app/seed.sql"
COPY backend/src/db/seed.sql ./seed.sql

# File uploads directory — mounted as a named Docker volume in production
# so attachments survive container restarts and image upgrades.
RUN mkdir -p /app/uploads

# ── Environment ─────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Riyadh

EXPOSE 3000

# Health check — waits up to 40 s for startup, then polls every 30 s
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health 2>/dev/null || exit 1

# dumb-init as PID 1 → correctly handles SIGTERM from `docker stop`
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server/index.js"]
