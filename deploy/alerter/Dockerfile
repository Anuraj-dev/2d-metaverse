FROM node:22-alpine
WORKDIR /app
# Zero runtime dependencies — copy the sources directly.
COPY package.json ./
COPY decide.mjs docker.mjs telegram.mjs index.mjs ./
USER node
CMD ["node", "index.mjs"]
