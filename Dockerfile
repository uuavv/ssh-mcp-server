FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN useradd --system --create-home --uid 10001 mcp
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
USER mcp
EXPOSE 3000
ENTRYPOINT ["node", "build/index.js"]
CMD ["--http", "--config-file", "/config/servers.json", "--pre-connect"]
