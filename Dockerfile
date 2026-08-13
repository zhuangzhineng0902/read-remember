FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build:web

FROM node:22-bookworm-slim AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server ./
COPY client/src /app/client/src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV DATABASE_PATH=/app/data/read-remember.sqlite
ENV WEB_ROOT=/app/client/dist
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/public ./public
COPY --from=server-build /app/server/data ./data
COPY --from=client-build /app/client/dist /app/client/dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
