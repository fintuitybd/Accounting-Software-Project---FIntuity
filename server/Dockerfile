# syntax=docker/dockerfile:1
FROM node:24.7.0-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci
COPY server/tsconfig.json server/tsconfig.build.json ./server/
COPY server/src ./server/src
RUN npm run build --workspace @ledgervault/server

FROM node:24.7.0-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY server/migrations ./server/migrations

WORKDIR /app/server
USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
