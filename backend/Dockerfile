# Build context is the REPOSITORY ROOT (not backend/), because the backend depends
# on the @metaverse/shared workspace package and must build it from source.
# Build with:  docker build -f backend/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Manifests first for layer caching. All workspace package.json files are needed so
# npm can resolve the workspace graph against the single root lockfile.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# Only the backend + shared workspaces (and the root) are needed to build the image;
# the frontend workspace's toolchain is skipped.
RUN npm ci --workspace metaverse-backend --workspace @metaverse/shared --include-workspace-root
COPY shared ./shared
COPY backend ./backend
# Shared must be built before the backend typechecks/emits against it.
RUN npm run build --workspace @metaverse/shared \
  && npm run build --workspace metaverse-backend

FROM node:22-bookworm-slim AS runtime
ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# Production deps for the backend + shared workspaces only (no dev tooling, no
# frontend deps). The @metaverse/shared workspace is symlinked into node_modules.
RUN npm ci --omit=dev --workspace metaverse-backend --workspace @metaverse/shared --include-workspace-root \
  && npm cache clean --force
# Built JS from both workspaces; the symlink above points node at shared/dist.
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/migrations ./backend/migrations
# Generated server geometry manifest (loaded/validated at startup + readiness).
COPY backend/assets ./backend/assets
USER node
EXPOSE 3001
# Run from the backend workspace so `dist/...` paths (and the compose migrate/seed
# commands) resolve; node walks up to /app/node_modules for deps + the shared symlink.
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
