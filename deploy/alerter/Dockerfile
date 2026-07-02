FROM node:22-alpine
WORKDIR /app
# Zero runtime dependencies — copy the sources directly.
COPY package.json ./
COPY decide.mjs docker.mjs telegram.mjs index.mjs ./
USER node
# The readiness file is written by index.mjs only after the alerter is
# operational: startup announcement delivered + Docker events subscription
# established (or no-token idle mode entered).
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=3 \
  CMD test -f "${ALERTER_READY_FILE:-/tmp/alerter-ready}"
CMD ["node", "index.mjs"]
