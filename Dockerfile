FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY tsconfig*.json eslint.config.cjs .prettier* ./
COPY src ./src
COPY test ./test
COPY demo ./demo
RUN npm run build && npm run build:demo && npm run test:types && npm run lint && npm run format:check
CMD ["node", "--test", "test/unit.test.cjs", "test/integration.test.cjs", "test/migrations.test.cjs"]
