# MX Monitor Tool

A local, read-only Linux Web Dashboard for MarXman Studio. **M1 is implemented:** live machine metrics, independent Worker observation, identity-verified processes, tasks/checkpoints, and a bounded event timeline. No Worker installation or running service is required. Nothing in the dashboard starts, stops, signals, retries, or changes Worker.

One root package manifest and strict TypeScript configuration cover the Fastify backend, Vue 3 frontend, shared contracts, tests, and tooling. The company Tool App architecture and M0 lifecycle/security/SEA conventions are preserved.

Requires Node **>=22.12** and npm for development/building. Verification uses Linux Node 22.23.4 and 24.14.0. The native Linux SEA includes Node and all frontend assets; launching it needs no source tree or installed Node. It still needs compatible operating-system libraries. Installation needs network access unless dependencies are cached; the built app has no remote assets, telemetry, or model calls.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run test:ui
npm run build
npm run package
npm run test:smoke
./dist/mx-monitor-tool --no-open
```

`npm run dev` supervises separate Vite/backend subprocesses, waits for Vite readiness, and opens the frontend. Ctrl+C closes both. `npm run build` runs Vue/TypeScript checking, builds the SPA, embeds its assets, and bundles the backend to `build/server.cjs` targeting Node 22. `npm run package` rebuilds and creates a native Linux SEA using the **currently running Node runtime**. Native Linux packaging is supported; cross-platform packaging is not implemented.

```bash
node build/server.cjs --no-open  # headless: remains running after tabs close
./dist/mx-monitor-tool          # desktop: opens the default browser
./dist/mx-monitor-tool --no-open --worker-state-dir /path/to/existing/worker/state
```

SEA always stops two seconds after its last authenticated lifecycle tab disconnects. It waits indefinitely before the first tab connects, and refreshes can reconnect during the grace period. Runtime env variables cannot disable this baked setting. Ordinary Node/dev/Docker builds keep running. SIGINT/SIGTERM close the Monitor only.

The port block **3490–3499 remains provisional, not officially reserved**: backend `3490`, Vite `3491`. No external company registry was available or modified. See [ports](docs/ports.md). A validated `PORT` override changes the backend; Vite follows at `PORT + 1`. An unrelated port occupant produces an error; forwarding requires the existing health response to identify this app. Identity/ports originate in `shared/config.ts`; regenerate Compose after changing them.

| Configuration | Behavior |
|---|---|
| `PORT` | Backend port, integer 1–65534; default from shared config. |
| `HOST` | Default `127.0.0.1`; explicit `0.0.0.0` supports containers/headless use. Loopback Host-header checks remain enforced. |
| `MX_MONITOR_TOOL_NO_OPEN=1` / `--no-open` | Suppress the OS browser opener. |
| `MX_MONITOR_TOOL_WORKER_STATE_DIR` / `--worker-state-dir <path>` | Existing Worker root; CLI takes precedence. Paths must be nonempty and contain no NUL. |
| `MX_MONITOR_TOOL_SAMPLE_MS` | Machine/process/service/event cadence; default 1000 ms, range 250–10000. |
| `MX_MONITOR_TOOL_TASK_SAMPLE_MS` | Task/checkpoint/scheduling cadence; default 2000 ms, range 500–60000. |
| `MX_MONITOR_TOOL_WORKER_STALE_MS` | Service heartbeat staleness; default 90000 ms, range 1000–3600000. Adjust for the Worker's configured heartbeat; its default is 30 s. |
| `MX_MONITOR_TOOL_DEV=1` | Dev mode; set by the supervisor. |
| `MX_MONITOR_TOOL_OPEN_URL` | Optional URL on the exact local application origin; validated. |

Without an explicit Worker root, the conventional `~/.local/state/mx-admin-agents` is observed **only if present**, never created. A W4.2 smoke run can use an entirely different state root; point the option at its `state` directory, not its repository, report, or transcript directory. Runtime root contents are rechecked; changing configuration requires restart.

The four working views retain M0's palette and system light/dark preference:

- **Overview:** real CPU/RAM/swap/load/uptime, separate Monitor transport and Worker health, heartbeat/freshness, verified current run/requested model, task counts, and stream diagnostics.
- **Processes:** collapsible tree from recorded PID/start-tick/boot identities and verified descendants, CPU deltas, RSS, elapsed time, and explicit unverified/partial states. Names alone never establish ownership.
- **Tasks / Checkpoints:** feature/task filtering, recorded task state versus live execution, dependencies, step progress, scheduling launches/failure attempts, attention/wait reasons, and checkpoint history. Failure attempts are not mislabeled as retries. Requested models are not reported as independently verified actual models.
- **Events:** newest-first supported event types, local severity/type filters, fixed safe summaries, and bounded history. Raw event reasons/payloads, prompts, credentials, transcripts and environments are never displayed.

Persisted BUSY never implies a live Worker. Liveness requires matching boot ID, PID and start ticks, a non-zombie process, and a sufficiently fresh service heartbeat. A dead/mismatched identity means OFFLINE; inaccessible/incomplete evidence means UNKNOWN; a live identity with stale heartbeat means STALE. Last persisted state remains visibly separate. Missing/unconfigured/unsupported/corrupt sources show explicit states. Task claims and orphaned recorded agents are checked independently of service health.

Only verified W4 record families are supported: service/scheduling/features/checkpoints v1, task v1/v2, and the verified unversioned claim/event shapes. See [Worker compatibility](docs/worker-state-compatibility.md) for exact allowlists, source references, limits, and unsupported cases. The app never imports or executes Worker code.

| GET endpoint | Security / purpose |
|---|---|
| `/api/health` | Minimal public app identity/version/dev probe, with Host/origin checks. |
| `/api/session` | Same-origin cookie bootstrap; HttpOnly, SameSite=Strict, scoped to `/api`, random per start. |
| `/api/snapshot` | Session required; full sanitized coherent snapshot and per-source freshness. |
| `/api/stream` | Session required; monitoring SSE, initial full snapshot on every connection, ordered sequence/server identity, subsequent shared snapshot updates and heartbeat. |
| `/api/lifecycle` | Separate authenticated SSE for tab lifetime; unchanged M0 behavior. |

The frontend fetches an initial snapshot and then uses native EventSource reconnects. Every new stream resynchronizes with a full snapshot; old event IDs do not request a historical replay. Sequence/server identity prevents duplicate/out-of-order updates and handles backend restarts. Lifecycle bootstrap refreshes the cookie after restart. No credentials travel in query strings.

Collection is shared across tabs and stops polling when the last monitoring subscriber leaves. Ordinary snapshot requests collect on demand using the same cache. There are no per-tab collectors, Worker locks, persistent metrics DB, recursive file APIs, Git polling, process environments, or full command-line reads. Source files open read-only with no-follow checks through pinned directory handles; traversal, symlinks, hard links, special files, oversized records and excessive JSON depth are refused. Event tailing handles incomplete lines, rotation/truncation, duplicates and timestamp disorder.

Boundaries are explicit: 128 tasks, 64 features, 64 processes, process depth 4, 100 recent events, 256 KiB per record, JSON depth 16, 128 KiB event bytes per cycle, 16 KiB event lines, 32 monitoring subscribers, and a 4 MiB per-client output-queue cap. Checkpoint display is capped at 20 per task / 400 per snapshot; source records are capped at 256 checkpoints. Source caps/partial errors are shown. File work has a cooperative 500 ms cycle budget and process traversal a 200 ms budget; filesystem operations already in the kernel are not forcibly interrupted.

Production preserves strict CSP, no-store/nosniff/same-origin headers, Host/origin checks and restricted SPA fallback. Vite dev permits only its necessary local HMR/style exceptions. The API exposes no Worker, Git, process or file mutation operations.

Docker is optional and **does not imply full host visibility**. By default it observes its available proc namespace and has no Worker host mounts, host PID namespace or privileged access.

```bash
npm run docker:config

docker compose -f docker/docker-compose.yml config --quiet
docker compose -f docker/docker-compose.yml up --build
npm run test:docker
docker compose -f docker/docker-compose.yml down
```

Compose publishes only to host loopback; `APP_PORT` changes only the host-side port. The build stage includes source/tests for strict checking; the non-root runtime contains only `/app/server.cjs` above Node 22 Alpine. No source, node_modules, tests, env files, or state registry enters the runtime image.

Validation commands:

- `npm test`: original M0 tests plus deterministic verified-schema fixtures, fake proc identities, freshness, file containment, byte/tree integrity, event tailing, auth/SSE ordering/resync/caps/cleanup, and concurrent subscription checks.
- `npm run test:ui`: actual Vue component rendering, safe/empty/stale/error states and escaping. Generates clearly labeled synthetic fixture HTML plus a real-machine component sample under `build/ui/`. These are rendered component artifacts, not browser screenshots.
- `npm run test:smoke`: fresh build/SEA required; exercises standalone assets, real monitoring SSE updates, stopped schema-matched fixtures, M0 desktop/headless lifecycle, browser arguments through a stub, dev proxy, collisions, and short CPU/RSS measurements in `build/resources-m1-node*.json`.
- `npm run test:observe`: optional real-machine/read-only configured-state observation. Records a warm CPU sample and before/after hashes for bounded allowlisted state files under `build/`. A concurrently active Worker can legitimately change those hashes; the command never launches or controls it.

Tests never invoke real agents or model APIs. All synthetic fixtures are confined to `build/`; real observations and fixture demonstrations are labeled separately. No graphical browser was available for validation in this session; interactive browser appearance/behavior is not claimed verified.

See [architecture](docs/architecture.md), the historical [M0 report](docs/M0_IMPLEMENTATION_REPORT.md), and the [M1 implementation report](docs/M1_IMPLEMENTATION_REPORT.md). M1 delivery includes no commits or pushes and awaits operator review.
