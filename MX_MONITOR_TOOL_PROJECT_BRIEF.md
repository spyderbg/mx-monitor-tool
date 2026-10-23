# MX Monitor Tool — Project Bootstrap & MVP Specification

**MarXman Studio Tool App** · **Implementation brief for Codex CLI**  
**Target directory:** `/home/plamen/_Projects/MarXman/mx-monitor-tool`  
**App ID:** `mx-monitor-tool` (derived from the directory name)  
**Platform for MVP:** Ubuntu/Linux, single local machine  
**Technology:** TypeScript · Node.js · Fastify · Vue 3 · Vite · Server-Sent Events (SSE) · Node SEA

> **Instructions to the coding agent:** Implement a new, independent project in the specified directory. Follow this document and the company's **“TS project structure.md” / MarXman Studio Tool App standard**. The requirements below are self-contained where possible; if the full standard file is available locally, read it first and treat it as the architectural source of truth. Do not rewrite or modify the Feature Coordinator / Worker project. Inspect existing files and report any conflicts before replacing them.

## 1. Purpose

Build **MX Monitor Tool**, a local, read-only Web Dashboard that shows what is happening **in real time on one Linux machine**, with special visibility into the independent **MX Feature Coordinator / Autonomous Worker** ecosystem (Claude Code, Codex, tasks, checkpoints, events, process tree, recovery and attention states).

The Monitor is an **observer, not a controller**. It must remain useful even when the Worker is stopped, broken, or unavailable. Monitor failure must have **zero effect** on the Worker.

### Non-negotiable requirements

1. **Completely separate application**, codebase, lifecycle, and repository from `mx-admin-cloud`. No code imports or shared runtime dependencies with Worker.
2. **Web Dashboard** using Vue 3 + TypeScript; not a terminal UI or a plugin embedded in another app.
3. **TypeScript backend** using Node.js + Fastify. One project-wide `package.json`, one strict `tsconfig.json`.
4. **Read-only monitoring**. Never schedule, stop, pause, restart, signal, kill, retry, recover, or modify Worker tasks or processes. Never update Worker files, locks, claims, databases or Git repositories.
5. **SSE-based live updates** from the Monitor backend to its frontend. No Worker-side API or other changes may be required.
6. **Node Single Executable Application (SEA)**: a standalone Linux executable bundling the backend, embedded SPA and Node runtime. No Python runtime required.
7. **Local-only by default**: bind to `127.0.0.1`; enforce same-origin and application session security.
8. Observe **one machine**, not a distributed fleet, in MVP. Architect collectors so more machines can be added later without pretending the first release supports them.
9. Never invoke Claude Code, Codex, remote AI endpoints, paid APIs, or GitHub as part of the Monitor runtime.
10. Favor reliable, safe, low-overhead observation over visual complexity.

## 2. Company Tool App Standard — Mandatory Foundation

Preserve the following conventions from **MarXman Studio's TS project structure**.

### Project identity and ports

- Derive the project name from the folder: `mx-monitor-tool`.
- Set `package.json.name` and `shared/config.ts::APP_ID` to **exactly** `mx-monitor-tool`.
- Use one consistent app-specific environment prefix: `MX_MONITOR_TOOL_` (for example, `MX_MONITOR_TOOL_DEV`, `MX_MONITOR_TOOL_NO_OPEN`, `MX_MONITOR_TOOL_WORKER_STATE_DIR`).
- Keep the name in those **two canonical locations** only; use imports/references elsewhere.
- Allocate a **free port block of 10** from the MarXman global port registry (`PORTS.md` in a parent project directory or shared equivalent). Backend = block base, Vite = base + 1; define only in `shared/config.ts`.
- **Do not invent or silently claim a company-wide port block.** Inspect the registry. If inaccessible or absent, propose a candidate, keep it clearly marked provisional, and request the operator to confirm or register it. Do not edit files outside the target project without permission.
- Support a validated runtime `PORT` override. Report a port collision with an unrelated app; forward/open an existing instance only when its `/api/health` returns this `APP_ID`.

### Repository and build conventions

- Exactly **one** root `package.json` and **one** strict root `tsconfig.json`; no nested package manifests, workspaces, or monorepo framework.
- **ESM TypeScript** source. Share API types in `shared/`. Type-check Vue with `vue-tsc --noEmit`.
- Allowed dependency direction: `backend → shared`, `frontend/src → shared`; no frontend imports of backend internals or reverse imports.
- Use **Fastify** and `createServer(options)` factory; separate startup, routes, lifecycle, OS integrations, and collectors.
- Vue 3 SFCs with `<script setup lang="ts">`; composables for SSE, state, timers and data fetching.
- **Vite** with its root in `frontend/`, SPA built to `build/frontend/`.
- Tool scripts in `scripts/*.ts` via `tsx`; include `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run package`. Add lint if appropriate.
- Build process: Vue build → embedded asset generator (`build/embedded.ts`) → backend bundled by esbuild → Node.js SEA executable injected with `postject`.
- Preserve `backend/embedded.ts` as a type-safe, compilable placeholder before building.
- `build/` and `dist/` are generated and Git-ignored.
- Develop against the standard's supported Node version (Node >=22.12; ESBuild backend target Node 22); verify actual compatibility with the current local runtime before packaging.

### Runtime/lifecycle conventions

- Production backend serves both the embedded SPA and typed `/api/*` endpoints over one port; Vite dev server proxies `/api` to Fastify.
- On standalone desktop launch: bind `127.0.0.1`, open the default browser and detect an already-running instance safely.
- Implement `--no-open` and app-specific environment alternatives.
- Preserve the company `STOP_ON_PAGE_CLOSE` behavior:
  - Default for ordinary Node/backend and headless builds: `'false'`.
  - **SEA executable:** baked to `'true'`, not runtime-overridable.
  - Last browser tab closes → exit after the standard **2-second grace period**, allowing refresh/reconnect. Before the first tab connects, do not exit prematurely.
  - Keep a dedicated **authenticated `/api/lifecycle` SSE** for tab lifetime tracking.
- `/api/health` must return app identity from `APP_ID` and usable health metadata.
- Clean `SIGINT`/`SIGTERM` handling; exit the Monitor only, **never the Worker**.

### Security conventions

- Default bind only to loopback and reject foreign Host headers / unauthorized cross-site API requests.
- Follow company security headers: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and a strict SPA CSP.
- Use a random per-start application session cookie (`HttpOnly`, `SameSite=Strict`) and protect API **and SSE** endpoints consistently. Design EventSource authentication to work with same-origin cookies, not a token in query strings.
- SPA fallback only for navigation routes, never for missing assets or `/api/*`.
- Never expose secrets, complete process environments, raw Worker transcripts, prompts, auth files or arbitrary file contents.

### Docker compatibility

- Include the company-standard `docker/app.Dockerfile`, `docker/docker-compose.yml` and root `.dockerignore` layout. Keep the container a **headless packaging option**, not the primary Linux-host Monitor runtime.
- Docker is secondary to standalone Linux usage. A container cannot accurately observe host `/proc` and host Worker state by default: **do not claim host-monitoring support inside Docker without explicit documented host mounts / PID namespace permissions**.
- No Docker-specific shortcuts in application logic. Do not require Docker for the MVP.

## 3. Architectural Boundary: Monitor vs Worker

```text
One Linux host

  MX Feature Coordinator / Worker         MX Monitor Tool (separate process)
  ├─ Scheduler / worker service           ├─ Fastify API + SSE
  ├─ Claude Code / Codex agents           ├─ Linux system collector
  ├─ Claims / checkpoints                 ├─ Linux process collector
  ├─ Status / events                      ├─ Worker state adapter (read-only)
  └─ Durable state files ── read only ───► └─ Vue 3 Dashboard

                   /proc ── read only ─────►

  Worker never knows about Monitor. The Monitor never controls Worker.
```

### Isolation requirements

- Do **not** import Python modules, spawn `feature.py`, or call Worker CLI to collect state. The Monitor reads documented, allowlisted state files itself.
- Do **not** modify `mx-admin-cloud`, its configuration, tests, event formats, or service startup to accommodate Monitor.
- Do **not** require Worker to be alive. The UI must distinguish `RUNNING`, `STOPPED`, `STALE`, `UNAVAILABLE`, `NOT CONFIGURED`, and `UNKNOWN` when appropriate; never infer health solely from existence of a state file.
- Worker state is a potentially unstable **external format**. Hide it behind a versioned `WorkerStateAdapter` interface with validated parsers; reject unsupported formats gracefully. Do not guess undocumented schemas.
- The Worker-state location must be configurable (env/CLI), defaulting to the user's conventional `~/.local/state/mx-admin-agents` **only if it exists**. Do not create this directory when reading it.
- Do not read `auth`, secret, token, credentials or transcript files. Prefer explicit allowlists over recursive directory dumping.
- Monitor state and Worker state must be separated. MVP should not write any persistent metrics database into the Worker directory.
- Make status freshness visible: source timestamp, last successful read, age, and clear stale/error messages.

## 4. MVP Scope — What to Implement

### A. Overview dashboard

Clean, responsive developer-operations dashboard, dark-mode-friendly (system theme), optimized for desktop and acceptable on narrower screens.

Display:

- Machine: hostname, OS, uptime, CPU usage, load average, RAM used/available/total, swap used/total, data timestamp.
- Monitor connection indicator (SSE connected/reconnecting/disconnected) and last-update age.
- Worker: current status, current feature, active task/step/agent/model, last heartbeat, run duration, last error/attention state **when verifiable**.
- Counters: active tasks, waiting tasks, failed/attention tasks, verified tasks **if state supports them**.
- Never show invented metrics. Use `unknown`/`not available` and explanatory hints instead.

### B. Processes view

- A small process tree focused on **proven Worker-owned** processes when identity evidence exists.
- Display PID, parent PID, executable name, state, CPU, RSS memory, elapsed time and attribution (`worker`, `agent`, `child`, `unverified`).
- Verify process identity using recorded PID **and** start time / boot ID where available, not name matching alone.
- Never conclude a `claude`, `codex` or `python` process belongs to Worker based only on its name.
- `/proc` may be incomplete or permission-denied; surface partial data instead of crashing.
- **Do not read or expose full command lines or `/proc/<pid>/environ`** (both may contain sensitive values). Avoid probing all processes' open files.
- Never send signals to any process.

### C. Tasks and checkpoints

If supported by verified Worker state format, show per-task:

- Feature ID, task ID, role, state, dependency/waiting indication.
- Agent/provider/requested model, active step, completed steps, retries / launch count.
- Last checkpoint sequence, commit short SHA and timestamp.
- `NEEDS_ATTENTION` reasons and status freshness.

Support absent/unknown state with a clear empty/error view, not mock success data.

### D. Recent events

- Present a bounded timeline of allowlisted, sanitized Worker events (for example start, stop, launch, checkpoint, waiting, error), sourced from known event data if present.
- Newest first, readable timestamps, severity/type filters.
- Do not display full prompts, raw CLI logs, environment values or potentially sensitive unstructured event payloads.
- If the event schema is unknown, show `Events unavailable` and document the missing adapter; do not invent event history.

### E. Real-time updates

- Dedicated authenticated `/api/stream` SSE for **monitoring data**, separate from `/api/lifecycle` SSE for window lifecycle.
- Initial snapshot via `/api/snapshot`, then incremental SSE updates or coherent snapshot events; include monotonically increasing sequence/revision, UTC timestamp and source freshness.
- Suggested collector cadence (tunable and resource-conscious):
  - CPU/RAM/worker heartbeat/process identities: ~1 second.
  - Tasks/checkpoints: ~2 seconds or on safe filesystem changes.
  - Events: incrementally as new entries arrive.
  - Git information: not required in MVP; avoid expensive repeated Git subprocesses.
- Heartbeat SSE messages should allow reconnect detection. Use `EventSource` automatic reconnect + initial resynchronization after connection loss.
- Control backpressure, cap event buffers, and free timers/listeners when clients disconnect.
- Collector errors must be isolated and represented as typed partial failures, not crash the server.

## 5. Linux Data Collection Rules

Prefer standard Node libraries (`node:fs`, `node:os`, `node:process`) and safely parsed `/proc` files; add a small dependency only if it meaningfully simplifies correctness.

- Use `/proc/stat` deltas to calculate **CPU utilization**; do not label load average as CPU percent.
- Use `/proc/meminfo` (`MemAvailable`, `MemTotal`, `SwapTotal`, `SwapFree`) for correct machine memory statistics.
- Use `/proc/loadavg`, `/proc/uptime`; account for Linux-specific behavior.
- For process CPU%, calculate deltas of process CPU ticks over elapsed system time, not raw lifetime counters.
- Parse `/proc/<pid>/stat` carefully because the `comm` field can contain spaces and parentheses.
- Guard PID reuse via `starttime` (and boot ID when Worker evidence provides it).
- Handle `ENOENT`, `EACCES`, kernel race conditions and malformed data without throwing at the API boundary.
- Bound the number of process records, file sizes, scan depth and per-cycle time. Prefer targeted process discovery over scanning every environment.
- Report `unsupported` for non-Linux hosts in v1 rather than silently returning zeros.
- Use CPU and memory metrics as observations only; **do not modify OOM settings, limits, sysctls or process priorities**.

## 6. Proposed Source Layout

Respect the standard's directories and add focused modules as needed. Suggested layout:

```text
mx-monitor-tool/
├── backend/
│   ├── main.ts                     # process startup, signals, browser open
│   ├── server.ts                   # Fastify factory, common security, assets
│   ├── platform.ts                 # OS integration
│   ├── page-lifetime.ts            # company standard tab lifecycle
│   ├── embedded.ts                 # placeholder for generated assets
│   ├── collectors/
│   │   ├── machine.ts              # Linux CPU, RAM, swap, load
│   │   ├── processes.ts            # targeted /proc process observations
│   │   ├── worker-state.ts         # external Worker state adapter
│   │   ├── checkpoints.ts          # verified checkpoint reading
│   │   └── events.ts               # bounded/sanitized event tailer
│   ├── monitor/
│   │   ├── aggregator.ts           # coherent snapshots + timestamps
│   │   └── stream.ts               # SSE subscriptions/backpressure
│   └── routes/
│       ├── snapshot.ts
│       └── stream.ts
├── frontend/
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       ├── components/
│       │   ├── OverviewDashboard.vue
│       │   ├── WorkerStatus.vue
│       │   ├── ProcessTree.vue
│       │   ├── TaskList.vue
│       │   └── EventTimeline.vue
│       ├── composables/
│       │   ├── useBackendLifetime.ts
│       │   └── useMonitorStream.ts
│       └── styles.css
├── shared/
│   ├── api.ts                      # all shared response/event types
│   └── config.ts                   # APP_ID + PORT_BLOCK single source of truth
├── scripts/
│   ├── dev.ts
│   ├── build.ts
│   ├── package.ts
│   ├── packaging.ts
│   └── postject.d.ts
├── tests/
│   ├── fixtures/                   # synthetic Worker state and fake /proc
│   └── ...
├── docker/                         # standard-compatible headless container packaging
├── docs/
│   ├── architecture.md
│   └── worker-state-compatibility.md
├── AGENTS.md
├── README.md
├── vite.config.ts
├── tsconfig.json
└── package.json
```

Keep `server.ts`, `main.ts` and `App.vue` relatively small. File names are a proposal; make reasonable changes without violating the standard.

## 7. API Contract — Initial Proposal

Define contracts once in `shared/api.ts` and validate external file data before mapping it to these types.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Monitor identity and service health, for second-instance detection |
| `GET` | `/api/snapshot` | Complete current sanitized snapshot; empty/stale sections explicitly marked |
| `GET` (SSE) | `/api/stream` | Live data events, reconnect/heartbeat, version and sequence |
| `GET` (SSE) | `/api/lifecycle` | Standard desktop tab lifetime connection |

Proposed shared types (adapt as needed): `MonitorSnapshot`, `MachineMetrics`, `WorkerSummary`, `TaskSummary`, `CheckpointSummary`, `ObservedProcess`, `MonitorEvent`, `SourceStatus`, `StreamEnvelope`.

Each source should have status (`ok`, `stale`, `unavailable`, `unsupported`, `error`), `observedAt`, and optional sanitized error detail. Use UTC ISO timestamps. **Distinguish Monitor transport health from Worker health**. Prefer `null` or explicit availability flags over misleading zero values.

The public API is read-only. Do not add mutation endpoints for Worker, tasks, process control, Git or files.

## 8. Observability Trust & Safety

- Ensure snapshot collection does not take Worker locks, block Worker writes or alter access/update state intentionally.
- Read atomically written JSON defensively: tolerate an intermediate rename, truncation or file disappearance with a retry or `stale` state; never overwrite data.
- No general-purpose file browser or arbitrary `?path=` reader endpoints.
- Restrict all file readers to configured roots and allowlisted filenames, with symlink/realpath checks and file size caps.
- Sanitize all user-visible errors and events. Avoid logging token-like strings, absolute credential paths and full process commands.
- Read-only means **no changes to Worker-owned files or process state**. The Monitor may maintain its own transient session/caches and ordinary local application artifacts outside Worker state.
- Never label an orphan process as safe to kill, nor expose one-click process controls.
- Health must distinguish last-known persisted state from live state. A dead Worker with a `BUSY` state file is **not currently BUSY**.

## 9. User Experience

- A professional, compact operations UI suitable for a full-stack developer.
- Overview header: host, Monitor connection, Worker state, update age.
- Clear, separate panels/tabs: **Overview**, **Processes**, **Tasks / Checkpoints**, **Events**.
- Distinct but accessible badges for `RUNNING`, `SLOW`, `WAITING`, `NEEDS_ATTENTION`, `OFFLINE`, `STALE`, and `UNKNOWN` where supported.
- Compact process tree, task rows and recent event timeline; loading, empty, permission-denied and stale states must be designed explicitly.
- Display tooltips/explanations for ambiguous data, e.g. `not attributed`, `model not verified`, `heartbeat stale`.
- Avoid fake historical charts. A small live CPU/RAM sparkline may be built from in-memory samples only and clearly identified as such.
- UI controls are **display-only** (tabs, filtering, sorting, refresh, theme). No operational controls for Worker or OS.
- Do not show simulated/mock data as real state; fixtures may be used only in development/testing, with explicit labeling.

## 10. Delivery Plan

Implement in **two clearly reported milestones**, in the same new repository. Avoid unnecessary dependency inflation or premature architecture.

### M0 — Tool App foundation

- Project structure, config identity, port strategy, strict TS, Fastify factory, Vue/Vite skeleton, shared types, and the standard Docker packaging files (no promise of full host visibility in Docker).
- Standard lifecycle and security, including an authenticated SSE lifecycle.
- Typecheck, unit tests, production build and Linux Node SEA packaging.
- Basic dashboard with real machine CPU/RAM/load, Monitor connection state, and Worker `Not configured` if its state is absent.
- README with install, dev/build/package/run commands.

### M1 — Read-only Linux + Worker observability MVP

- `/proc` machine and process collectors with identity-safe tests.
- Read-only Worker state adapter, verified against available *actual* W4/W4.1 state formats or explicitly marked incomplete if unavailable.
- SSE real-time snapshot/event stream with bounded polling.
- Tasks/checkpoints/events UI (only sources that are reliably parsed).
- Error, stale and offline conditions; no Worker required for startup.
- Tests for read-only behavior, security, SSE reconnect and cleanup.

**Approval gate:** Do not infer undocumented Worker schemas. If the state layout or port registry cannot be verified, complete the safe parts, document what is blocked, and request the missing input instead of inventing fake integration.

## 11. Testing & Acceptance

Create and execute automated tests that cover:

1. **Independence:** Monitor starts with Worker absent and with state dir missing; no imports, calls or writes to Worker. Other services remain untouched when Monitor exits.
2. **Read-only:** snapshots and SSE do not alter fixture Worker records, claims, checkpoints or events (use checksums/bytes before and after).
3. **Machine data:** CPU delta math, MemAvailable semantics, swap, proc parsing with tricky names and disappearing PIDs.
4. **Process ownership:** PID reuse/starttime mismatch does not falsely assign ownership; same-named unrelated process is not attributed to Worker.
5. **Freshness:** dead/stale Worker record is not shown as live; absent/malformed/unsupported schema is reported honestly.
6. **SSE:** initial synchronization, reconnect/resync, heartbeat, disconnect cleanup, per-client bounded buffer and no leaked timers.
7. **Security:** foreign Host and cross-site calls blocked; API/SSE require valid session; path traversal/symlinks refused; secrets and raw environment never leaked.
8. **Lifecycle:** first tab connection, refresh grace, multiple tabs, last-tab auto-close for **SEA only**; no headless shutdown by default.
9. **Packaged binary:** Linux SEA starts standalone, serves assets and `/api/health`, opens browser unless `--no-open`, and exits cleanly when requested/after closing tabs.
10. **Quality:** `npm run typecheck`, `npm test`, `npm run build`, `npm run package` all pass; optional lint passes.

Performance guideline: keep polling responsive and lightweight on a developer laptop; measure actual idle and active CPU/RSS during testing and report the numbers rather than promising fixed thresholds without measurement. Any watch/interval must clean up on shutdown or lost SSE subscribers.

## 12. Operator Commands to Document

```bash
cd /home/plamen/_Projects/MarXman/mx-monitor-tool
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run package
./dist/mx-monitor-tool --no-open
```

These are **intended** commands; implement the scripts and verify actual CLI behavior before claiming they work. Do not use the final executable until it has been built.

Document optional `MX_MONITOR_TOOL_WORKER_STATE_DIR` and the allocated port block in README. No startup-time modification of the Worker state dir.

## 13. Scope Exclusions for This Initial Project

Do **not** implement in M0/M1:

- Worker start/stop/restart/pause, process kill buttons, retries, checkpoint recovery or Git mutation.
- Remote multi-host support, SSH polling, cloud agents, AWS, metrics ingestion server, Kubernetes, Grafana/Prometheus stack.
- Persistent monitoring database or telemetry upload.
- AI chat, model inference, cloud billing, agents, notifications or external account integrations.
- Docker-based host PID monitoring requiring privileged permissions.
- Production Worker code changes or any modifications to the existing `mx-admin-cloud` project.

## 14. Coding Agent Instructions & Final Report

1. Work **only inside** `/home/plamen/_Projects/MarXman/mx-monitor-tool`, except when **reading** approved external architecture documents/state samples. Do not modify any other project or global port registry without asking.
2. Inspect the target directory first; do not overwrite existing user files. If it contains unexpected work, stop and explain.
3. Check for and read the full MarXman Studio `TS project structure.md` if supplied; follow its rules. Flag any conflicts between this spec and the standard. The company standard takes precedence for Tool App lifecycle, packaging and folder conventions; this spec defines the Monitor's read-only product behavior.
4. Start with a concise implementation plan, then implement M0 and the M1 features that can be validated. Do not invent external Worker state schemas to make a demo look complete.
5. The Monitor runtime and its tests must never spawn Claude Code, Codex, or any other AI agent or invoke model APIs. This restriction does **not** prohibit using the current Codex CLI development session to write the project. No GitHub writes, production Worker changes, or persistent daemons are required.
6. Make appropriate focused unit/integration tests and provide honest verification; do not claim a packaging or integration check passed unless executed.
7. If a test/packaging run is blocked by host configuration, state exactly what is blocked and how to reproduce it. Keep working parts usable.
8. Do not commit, push, publish releases, or mutate external directories without explicit operator approval.

**Final report must include:** created file tree; dependencies and versions; port block and whether officially reserved; APIs; SSE/lifecycle implementation; verified Worker state formats; UI screenshots if practical; tests (pass/fail/skip counts); typecheck/build/SEA results; security verification; measured resource usage; any unsupported/uncertain features; and precise next steps.

---

### Definition of success

A user can start `mx-monitor-tool` independently on Ubuntu, open its Vue Web Dashboard, see **real machine metrics** and **correctly attributed, verified Worker information when the configured state is available**, see updates through **authenticated SSE**, and package the project as a **single Node SEA executable** — without Monitor ever controlling, modifying or disturbing Worker.
