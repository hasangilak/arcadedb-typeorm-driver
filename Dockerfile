FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build
CMD ["node", "--test", "test/unit.test.cjs", "test/integration.test.cjs"]
