  

This document describes the architecture and file organization of this project. Use it as a guide when creating or extending a project with the same structure.

  

## Overview

  

A full-stack TypeScript application packaged as a **single standalone executable**:

  

- **Backend**: Fastify HTTP server on Node.js (TypeScript, ESM).

- **Frontend**: Vue 3 single-file components, built with Vite.

- **Shared**: TypeScript types and constants used by both sides.

- **Packaging**: Node.js Single Executable Application (SEA) — one binary per OS containing the Node runtime, backend bundle, and embedded frontend assets.

  

The app is a **local desktop-style app**: the backend binds to `127.0.0.1` only, opens the system browser, serves the embedded SPA, and shuts down when the last browser tab closes. It works fully offline.

  

## Project Name

  

When creating a new project from this template, **derive the project name from the current folder name** — never invent one or copy the template's name.

  

- Take the folder base name (e.g. `ts-hello-world`) and normalize it to **kebab-case**. This is the project name.

- From the same name, derive the **environment-variable prefix** in UPPER_SNAKE_CASE: `ts-hello-world` → `HELLO_WORLD` (e.g. `HELLO_WORLD_DEV`, `HELLO_WORLD_NO_OPEN`, `HELLO_WORLD_OPEN_URL`).

  

The name is defined in exactly two places, which must always match:

  

1. `"name"` in `package.json` (kebab-case).

2. `APP_ID` in `shared/config.ts` — the canonical in-code identifier.

  

Everywhere else the name is **referenced, not repeated**:

  

| Artifact | Value |

| --- | --- |

| `/api/health` app identification | `APP_ID` from `shared/` |

| Second-instance detection | `APP_ID` |

| Executable name | `dist/<name>` (kebab-case) |

| Docker `container_name` | `<APP_ID>-<service>` |

| Docker image name | `<name>` |

| Env vars | `<PREFIX>_*`, derived as above |

| Port registry entry | project name + port block |

  

Do not hardcode the project name in `backend/`, `frontend/`, `scripts/`, or Dockerfiles — import `APP_ID` or read it from `package.json`.

  

## Port Assignment

  

Projects built from this structure are meant to coexist on the same machine. To avoid port conflicts, ports are **allocated globally and declared once per project** — never hardcoded as literals in backend, frontend, or script code.

  

### Allocation scheme

  

- Reserve a **contiguous block of ports per project**, in steps of 10, starting from a family base (e.g. `3400`):

- `backend port` = block base (e.g. `3450`)

- `vite dev port` = block base + 1 (e.g. `3451`)

- remaining ports in the block stay free for future services of the same project (a second backend, a mock server, etc.).

- Keep a **port registry** next to the projects (e.g. a `PORTS.md` in the parent folder, or a shared team wiki): one line per project — app ID, block base, occupied ports. When creating a new project, take the next free block; never reuse a block, even for a deleted project.

- Derive the ports from the block base, never write them twice.

  

### Single source of truth in code

  

All port values live in `shared/config.ts` and are imported everywhere:

  

```ts

// shared/config.ts

export const APP_ID = 'ts-hello-world'; // = normalized folder name, see Project Name

export const PORT_BLOCK = 3450; // from the port registry

export const DEFAULT_BACKEND_PORT = PORT_BLOCK;

export const DEFAULT_VITE_DEV_PORT = PORT_BLOCK + 1;

```

  

Rules:

  

- `backend/main.ts`, `vite.config.ts`, and `scripts/dev.ts` import these constants; **no port literals anywhere else**.

- The `PORT` environment variable still overrides the backend port at runtime (dev proxy honors it too); the registry value is only the default.

- `vite.config.ts` reads the dev port from `shared/config.ts` (plus `process.env.PORT + 1` as a fallback path if the backend was overridden) instead of a literal.

- The second-instance check and `/api/health` keep working unchanged: a port collision with a *different* app is still detected and reported as "port in use" instead of being silently shared.

  

When creating a new project from this template: pick a free block, write it into the registry, set `PORT_BLOCK` in `shared/config.ts` — nothing else needs to change.

  

## Directory Layout

  

```text

.

├── backend/ Backend TypeScript code (Node.js + Fastify)

│ ├── main.ts Entry point: env/port parsing, startup, second-instance handling, signals

│ ├── server.ts Fastify instance: routes, hooks, security headers, asset serving

│ ├── page-lifetime.ts Keeps the backend alive while tabs are open; triggers shutdown

│ ├── platform.ts OS integration (open the default browser)

│ └── embedded.ts Placeholder module; build replaces it with generated frontend assets

├── frontend/ Vue 3 application (Vite root)

│ ├── index.html SPA entry HTML

│ ├── public/ Static assets copied as-is (favicon.svg)

│ └── src/

│ ├── main.ts Vue app bootstrap

│ ├── App.vue Root single-file component

│ ├── useBackendLifetime.ts Composable: lifecycle event stream + reconnect logic

│ └── styles.css Global styles

├── shared/ Code imported by BOTH backend and frontend

│ ├── api.ts API response types, app ID constants

│ └── config.ts Port block and default ports (single source of truth)

├── scripts/ Build/dev/packaging tooling (run via tsx)

│ ├── dev.ts npm run dev — Vite dev server + backend process

│ ├── build.ts npm run build — Vite build, asset embedding, esbuild bundle

│ ├── package.ts npm run package — SEA executable creation

│ ├── packaging.ts Helpers: target parsing, platform/runtime checks

│ └── postject.d.ts Types for the postject library

├── docker/ Container definitions

│ ├── app.Dockerfile Multi-stage image: build stage → runtime with only server.cjs

│ └── docker-compose.yml Service wiring: build context, ports, env, healthcheck, profiles

├── .dockerignore At the repo root; excludes node_modules, build, dist, .git

├── vite.config.ts Vite config: frontend root, dev proxy, output dir

├── tsconfig.json Single strict TS config covering all TS code, noEmit

└── package.json Single package.json for the whole monorepo

```

  

Generated (git-ignored) directories:

  

```text

build/ Vite output (build/frontend/), generated build/embedded.ts, server bundle (server.cjs), SEA blob, runtime cache

dist/ Final standalone executables

```

  

## Key Principles

  

1. **One `package.json`, one `tsconfig.json`** for the whole project. No workspace tooling. All code is TypeScript; the build produces plain JS.

2. **Strict TypeScript everywhere**, including `.vue` files (`vue-tsc --noEmit` in `typecheck`). `npm run build` runs typecheck first.

3. **`shared/` is the contract layer.** Backend and frontend must never duplicate API types. Anything used by both sides (response interfaces, app ID constants) lives in `shared/` and is imported by relative path from both sides.

4. **Clear dependency direction**: `backend → shared`, `frontend/src → shared`. Frontend never imports backend code and vice versa. Only `scripts/` may import tooling (Vite, esbuild).

5. **Separation of concerns inside `backend/`**: server setup/routes (`server.ts`) is separate from process lifecycle (`main.ts`), OS integration (`platform.ts`), and connection lifetime (`page-lifetime.ts`). Keep new backend features in new focused modules rather than growing `server.ts`.

6. **Frontend composables** (`useBackendLifetime.ts`) hold reusable Vue logic; `App.vue` stays declarative.

7. **Tooling is scripted, not configured via CLI flags.** Dev, build, and packaging logic lives in `scripts/*.ts`, run with `tsx`, referenced from `package.json` npm scripts.

  

## Backend Conventions

  

- Entry point is `backend/main.ts`. It:

- validates `PORT` (default from `DEFAULT_BACKEND_PORT` in `shared/config.ts`, see [Port Assignment](#port-assignment)),

- detects dev mode via an app-specific env var (e.g. `HELLO_WORLD_DEV=1`),

- handles `--no-open` / env-based browser suppression,

- on `EADDRINUSE` checks `/api/health` and forwards to the already-running instance instead of failing hard,

- installs `SIGINT`/`SIGTERM` handlers.

- `server.ts` exports a `createServer(options)` factory (not a singleton) so scripts and tests can construct it.

- Security invariants (keep these in any reorganization):

- Bind only to `127.0.0.1`; reject requests with foreign Hostnames (403).

- Reject cross-site API requests via `sec-fetch-site`.

- Send hardened headers on every response (`no-store`, `nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`).

- Session cookie: `HttpOnly`, `SameSite=Strict`, scoped path, random per-start token.

- Strict `Content-Security-Policy` on frontend responses.

- SPA fallback (`/index.html`) only for extension-less navigation paths — never for `/api/*` or missing assets.

- API routes return typed responses from `shared/api.ts`.

  

## Frontend Conventions

  

- Vite root is `frontend/` (`vite.config.ts` sets `root`), so `index.html` sits at `frontend/index.html` and source at `frontend/src/`.

- Dev server: `127.0.0.1` on `DEFAULT_VITE_DEV_PORT` from `shared/config.ts`, `strictPort`, `/api` proxied to the backend port (honors `PORT`).

- Build output goes to `build/frontend/` (outside the Vite root, `emptyOutDir: true`).

- Components use `<script setup lang="ts">`. API calls use `fetch` with `cache: 'no-store'` and timeouts; errors surface as user-visible state.

  

## Build & Packaging Pipeline

  

The single executable is produced in four stages (`npm run build`, then `npm run package`):

  

1. **Typecheck + frontend build** — `vue-tsc --noEmit`, then Vite compiles the Vue app into `build/frontend/`.

2. **Asset embedding** — `scripts/build.ts` walks `build/frontend/` and generates `build/embedded.ts`: a map of URL path → `{ mime, base64 }`. An esbuild plugin redirects the import of the placeholder `backend/embedded.ts` to this generated module.

3. **Backend bundling** — esbuild bundles from `backend/main.ts` (backend + dependencies + embedded frontend) into `build/server.cjs` (CommonJS, target Node 22).

4. **Executable creation** — `scripts/package.ts` uses Node SEA: write `sea-config.json`, generate the blob, copy the Node runtime for the target OS (downloading and checksum-verifying the Windows runtime when cross-packaging), inject the blob with `postject`, output to `dist/`.

  

Rule: `backend/embedded.ts` must stay a compilable placeholder with the same export shape as the generated module, so dev mode and typechecking work without a prior build.

  

## Docker Container

  

Besides the standalone executable, the project ships as a Docker image running the production bundle (`build/server.cjs`) in a container. The image is for server/headless usage: no browser is opened, and the app does **not** shut down when tabs close.

  

### Container assets live in `docker/`

  

All container definitions live in a dedicated `docker/` directory, following a per-service Dockerfile naming scheme:

  

```text

docker/

├── app.Dockerfile Multi-stage image for the application service

└── docker-compose.yml Service wiring: build context, ports, env, healthcheck, profiles

.dockerignore At the REPO ROOT (see below)

```

  

Rules:

  

- **Build context is always the repo root.** Compose sets `context: ..` and `dockerfile: docker/app.Dockerfile`. All `COPY` paths inside Dockerfiles are relative to the repo root, so the same image builds from any working directory.

- Because the context is the repo root, `.dockerignore` must sit at the repo root (not inside `docker/`). It must exclude at least: `node_modules`, `build`, `dist`, `.git`.

- One Dockerfile per service, named `<service>.Dockerfile`. This project has a single service (`app`); add more only if the app gains real services.

- Dockerfile **build-time configuration is passed as `ARG` → `ENV` pairs** (e.g. feature flags the frontend build needs to bake in), never by editing source.

  

### Required app adaptations

  

Docker runs the app headless, so the backend must support this via environment/CLI — the changes must be generic, not Docker-specific:

  

1. **Bind host**: `backend/main.ts` reads a `HOST` env var (default `127.0.0.1`). The container sets `HOST=0.0.0.0` because the port must be reachable from outside the container namespace. Published through `-p`, the Host header stays `localhost`, so the existing loopback-hostname check in `server.ts` still passes — do not weaken it.

2. **No browser launch**: pass `--no-open` (already supported) in the container command.

3. **No auto-shutdown**: comes for free — `STOP_ON_PAGE_CLOSE` defaults to `'false'` (see [Stop-on-page-close parameter](#stop-on-page-close-parameter)), so a container keeps running when tabs close. Do not set the parameter in the container.

4. **Signals**: the existing `SIGINT`/`SIGTERM` handlers already make `docker stop` graceful; do not change them.

  

### app.Dockerfile

  

Multi-stage, minimal runtime, non-root. The build stage needs the full source; the runtime stage needs only the bundle — `backend/server.ts` imports `../package.json`, but esbuild inlines it into `server.cjs`, so nothing else is copied.

  

```dockerfile

# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-alpine

  

FROM ${NODE_IMAGE} AS build

WORKDIR /app

  

COPY package.json package-lock.json ./

RUN npm ci

  

COPY backend shared frontend scripts ./

COPY vite.config.ts tsconfig.json ./

RUN npm run build

  

FROM ${NODE_IMAGE}

WORKDIR /app

ENV NODE_ENV=production \

HOST=0.0.0.0

COPY --from=build /app/build/server.cjs .

USER node

ARG BACKEND_PORT

EXPOSE ${BACKEND_PORT}

CMD ["node", "server.cjs", "--no-open"]

```

  

### docker-compose.yml

  

Compose owns the service wiring, not the Dockerfile: container naming, port publishing, environment, healthcheck, volumes, and profiles. Internal (container) ports are fixed from the app's registered port block; only the **host-side** port is a compose-level variable.

  

```yaml

services:

app:

container_name: ts-hello-world-app # <APP_ID>-<service>, APP_ID from shared/config.ts

restart: unless-stopped

build:

context: ..

dockerfile: docker/app.Dockerfile

args:

BACKEND_PORT: "3450" # the project's registered backend port

ports:

- "${APP_PORT:-3450}:3450" # host port overridable; container port fixed

environment:

- PORT=3450 # internal port, fixed = registered block base

healthcheck:

test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3450) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

interval: 30s

timeout: 3s

retries: 3

start_period: 5s

# volumes: add named volumes here when the app persists data,

# - app-data:/app/data never bind-mount source code into the runtime image

  

# volumes:

# app-data:

  

# profiles: optional auxiliary containers (CLIs, one-off jobs, debug tools) get their own

# service with `profiles: [<name>]` so they never start with the default `up`.

```

  

Conventions:

  

- `container_name` is `<APP_ID>-<service>` so parallel projects from this template never collide.

- The healthcheck reuses `/api/health` — the app must always keep that endpoint meaningful.

- Persistent state goes in **named volumes** declared at the top level, never into the image layer and never as bind mounts of host directories (except explicitly opt-in user data).

- Host volumes in a compose file inside `docker/` resolve relative to `docker/` — prefer named volumes to avoid confusion.

  

### Commands

  

```bash

docker compose -f docker/docker-compose.yml up --build

docker compose -f docker/docker-compose.yml run --rm <profile-service> # auxiliary tool

```

  

### Docker rules

  

- Runtime image contains only `server.cjs` on top of the Node base image — no source, no `node_modules`, no build tooling.

- Run as a non-root user (`USER node`).

- Pin the base image by version tag (e.g. `node:22-alpine`), matching the Node version used by SEA packaging (`>=22.12`).

- Do not add a container-specific code path in `backend/`; all differences (host, no-open, persistent) are env/CLI driven.

- Never copy `.env`, secrets, or the port registry into the image; inject secrets via compose `environment` interpolation (`${SECRET}`) at run time, with sane defaults only for non-secrets.

  

## Runtime Model

  

- One user-facing port (backend port from `shared/config.ts`, overridable via `PORT`). In production the backend serves both the API (`/api/*`) and the embedded SPA. In dev, Vite serves the frontend and proxies `/api`.

- The frontend opens an authenticated SSE connection (`/api/lifecycle`) per tab. Whether closing the last tab stops the backend is controlled by a single parameter (see below). When enabled, the backend exits after a 2-second grace period (`PageLifetime`), so a refresh reconnects within it. Before the first connection, it waits indefinitely.

- `/api/health` identifies the app (`APP_ID` from `shared/`) and dev mode — used for second-instance detection.

  

### Stop-on-page-close parameter

  

The backend must always support stopping itself when the last page closes. This behavior is a single parameter, `STOP_ON_PAGE_CLOSE`, and it is **always** defined — never inferred from dev mode or platform:

  

- **Default: `'false'`** — the backend keeps running regardless of open tabs (plain `node build/server.cjs`, dev mode, containers).

- **`dist` build: always `'true'`.** `scripts/package.ts` bakes the value into the standalone executable; it is not settable or overridable by the user — the packaged executable is a desktop-style app and must stop when the user closes the last tab.

  

Implementation rules:

  

- `main.ts` passes `onShutdown` into `createServer()` only when `STOP_ON_PAGE_CLOSE` is `'true'`; `server.ts`/`PageLifetime` stay agnostic — they simply do not wire the shutdown callback when it is absent.

- The packaging script sets the value at build time (esbuild `define` or a baked env in the SEA step), not via a runtime flag.

- The Docker section below relies on the default (`'false'`): a container must keep running when tabs close.

  

## Where to Put New Code

  

| Adding… | Put it in |

| --- | --- |

| API endpoint | Route in `backend/server.ts`; response type in `shared/api.ts` |

| Backend module (logic, integration) | New file in `backend/`, imported by `main.ts` or `server.ts` |

| Type/constant used by both sides | `shared/` |

| Port value | `PORT_BLOCK` in `shared/config.ts` + the external port registry — never a literal |

| UI component | `frontend/src/components/` (create when the first component is added) |

| Reusable Vue logic | `frontend/src/composables/use*.ts` |

| Static asset | `frontend/public/` |

| Build/packaging step | `scripts/`, wired into the relevant script and `package.json` |

| Container image config | `docker/<service>.Dockerfile` + `docker/docker-compose.yml`, root `.dockerignore`; env-driven app behavior only |

| npm dependency used only by the frontend | devDependencies (it is bundled by Vite) |

| npm dependency used by the backend | dependencies (it is bundled by esbuild) |

  

Do not introduce: a second package.json, nested `src/` outside `frontend/`, global mutable state in `backend/`, or imports from `frontend/` into `backend/` (or vice versa) other than through `shared/`.