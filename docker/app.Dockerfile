# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY backend/ backend/
COPY shared/ shared/
COPY frontend/ frontend/
COPY scripts/ scripts/
COPY tests/ tests/
COPY vite.config.ts tsconfig.json ./
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/build/server.cjs ./server.cjs
USER node
ARG BACKEND_PORT
EXPOSE ${BACKEND_PORT}
CMD ["node", "server.cjs", "--no-open"]
