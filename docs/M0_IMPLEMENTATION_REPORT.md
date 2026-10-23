# M0 implementation report — 2026-10-23

**Scope:** Tool App foundation only. M1 has not started. The two supplied specifications were read in full and retained unchanged. No external project source, Worker state, or company registry was modified. No commit, push, release, model invocation, or Worker command was performed.

**Delivery status:** M0 implementation, builds, Linux packaging, and automated checks are complete. Official company port reservation remains an external operator action; the implemented block is explicitly provisional.

**Created source tree** (the two supplied documents are omitted; generated/dependency directories are listed separately):

```text
.
├── .dockerignore
├── .gitignore
├── .npmrc
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── shared/
│   ├── api.ts
│   └── config.ts
├── backend/
│   ├── main.ts
│   ├── server.ts
│   ├── runtime.ts
│   ├── platform.ts
│   ├── page-lifetime.ts
│   ├── lifecycle.ts
│   ├── security.ts
│   ├── embedded.ts
│   ├── monitor.ts
│   ├── worker-location.ts
│   └── collectors/machine.ts
├── frontend/
│   ├── index.html
│   ├── public/favicon.svg
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       ├── styles.css
│       └── composables/
│           ├── useBackendLifetime.ts
│           └── useMachineDashboard.ts
├── scripts/
│   ├── dev.ts
│   ├── vite-dev.ts
│   ├── build.ts
│   ├── package.ts
│   ├── packaging.ts
│   ├── postject.d.ts
│   ├── docker.ts
│   ├── docker-smoke.ts
│   └── smoke.ts
├── tests/
│   ├── config.test.ts
│   ├── lifetime.test.ts
│   ├── machine.test.ts
│   └── server.test.ts
├── docker/
│   ├── app.Dockerfile
│   └── docker-compose.yml
└── docs/
    ├── architecture.md
    ├── ports.md
    ├── worker-state-compatibility.md
    └── M0_IMPLEMENTATION_REPORT.md
```

Generated, ignored artifacts: `node_modules/`, `build/frontend/`, `build/embedded.ts`, `build/server.cjs`, SEA config/blob/entry bundle in `build/`, local npm cache, verified Node 22 test runtime, test resource JSON, and `dist/mx-monitor-tool`. Test fixture/run directories are created inside `build/` and cleaned after tests. No persistent metrics database or Worker-side files are created.

**Architecture and dependencies**

One root package manifest and strict root TS configuration cover backend, Vue SFCs, shared code, tooling, and tests. Source uses ESM; backend/frontend import shared contracts without importing one another. Factories contain backend state. Process startup, OS integration, security, lifecycle, collection, and dashboard composition remain separate modules. Build checks Vue/TS before compiling. Vue is a development dependency because Vite bundles it; Fastify is the sole direct production dependency.

| Dependency | Exact version | Placement |
|---|---|---|
| fastify | 5.12.7 | dependencies |
| vue | 3.5.44 | devDependencies |
| vite | 8.3.5 | devDependencies |
| @vitejs/plugin-vue | 6.0.10 | devDependencies |
| typescript | 5.9.3 | devDependencies |
| vue-tsc | 3.3.13 | devDependencies |
| @types/node | 22.20.5 | devDependencies |
| esbuild | 0.28.2 | devDependencies |
| tsx | 4.23.15 | devDependencies |
| postject | 1.0.0-alpha.6 | devDependencies |

All direct dependencies are pinned; transitive resolution is recorded in the lockfile. Tests use Node's built-in test runner/assertions instead of another test framework. The Docker build's executed `npm ci` audit reported zero vulnerabilities at verification time. No separate lint configuration is included.

**Identity and ports**

The package name and shared `APP_ID` match the folder. Environment prefixes derive from the app ID. Backend/tooling reference shared identity and port constants; generated Compose literals originate from the same config.

Proposed block: **3490–3499**, backend **3490**, Vite **3491**. The project and inspected parent/ancestor locations had no `PORTS.md`/`ports.md` registry. The candidate had no listening TCP sockets when checked. This does not establish company-wide availability. The block is **not officially reserved**; the operator must confirm/register it or supply the official allocation. No external registry was edited. Runtime `PORT` validation and Vite's derived override are tested. An unrelated port occupant produces a collision error and remains untouched; matching app identity permits forwarding to the existing instance.

**Implemented APIs and transport**

| Endpoint | Behavior |
|---|---|
| `GET /api/health` | Minimal public identity/version/dev/health response; Host/origin protection applies. Used for instance detection and health checks. |
| `GET /api/session` | Same-origin session bootstrap, sets a random per-start HttpOnly, SameSite=Strict cookie scoped to `/api`. Does not return the token in JSON. |
| `GET /api/snapshot` | Session required; shared typed snapshot, schema version, revision, UTC timestamps, machine values and explicit Worker availability. |
| `GET /api/lifecycle` | Session required; SSE ready event, retry hint, 15-second heartbeat, bounded connections/output and disconnect cleanup. |

`/api/stream` is intentionally not implemented: the monitoring-data stream is an M1 deliverable. M0 polls snapshots once per second and uses its separate lifecycle SSE for Monitor connection state. No Worker/process/file mutation endpoints exist. The frontend retries unavailable sessions/connections and reboots its cookie session after backend restarts. Reconnect to lifecycle triggers a fresh snapshot; normal refresh polling resumes while connected. Browser restart/recovery behavior was reviewed in source but not driven in a browser.

Snapshot collection is on demand, coalesces concurrent requests, and caches a coherent sample for one second. No collector interval runs in the absence of requests. CPU uses successive aggregate `/proc/stat` samples and avoids counting guest counters twice. Initial/reset CPU is null. RAM uses `MemTotal - MemAvailable`; swap uses `SwapTotal - SwapFree`; load and uptime come from their respective proc sources. Fixed-path reads are capped at 64 KiB. Read/parse errors produce sanitized error states and null values, retaining the last success timestamp; non-Linux reports unsupported. There are no process collectors in M0.

**Lifecycle and packaging**

Ordinary Node/dev/headless builds always default to `STOP_ON_PAGE_CLOSE=false`. SEA's separate backend bundle bakes it to true; runtime environment attempts cannot disable it. Before the first tab, it waits indefinitely. Multiple tabs keep it alive; a refresh can reconnect during the two-second grace period; closing the last tab triggers graceful Monitor shutdown. Signals close the server and active lifecycle responses without touching another service.

Each lifecycle client owns a heartbeat timer cleared on disconnect. Server pre-close disposes lifetime state and destroys SSE responses. Capacity is 64 clients; slow output is dropped rather than queued without bound. Capacity release/reconnect and active-stream server shutdown were tested. The dev supervisor owns separate Vite/backend subprocesses, waits for Vite readiness, and cleans up both. This avoids Vite's own signal/exit handler terminating the supervisor prematurely; a dev smoke test caught that issue and passed after correction.

Vite emits the SPA, the build generates a URL-to-MIME/base64 asset map, and esbuild redirects the placeholder import while bundling CommonJS targeting Node 22. The placeholder still typechecks independently. Packaging follows the [official Node SEA blob/injection workflow](https://nodejs.org/api/single-executable-applications.html): copy the current native Linux Node runtime, generate its matching blob, inject with postject, and mark executable. Native Linux builds were executed with Node **24.14.0** and **22.23.4**. The Node 22 download was stored inside `build/` and SHA-256 checked against the [official release checksums](https://nodejs.org/download/release/v22.23.4/SHASUMS256.txt).

The final delivered executable uses **Node 22.23.4, Linux x64**, approximately **121 MiB**. The ordinary backend bundle is approximately **1.6 MiB**. The SPA is approximately 69.1 kB JS, 5.0 kB CSS, and 0.51 kB HTML before compression. SEA smoke tests copy the executable to an otherwise empty working directory, so execution cannot depend on source, assets, package.json, or node_modules beside it. Default browser invocation is tested using a controlled `xdg-open` stub that verifies the local URL. An actual system browser launch/render was not verified.

Final binary: **126,553,280 bytes**; SHA-256 `b7b503c209873c504f16594b6a7e3584b45bf9b7b8eaf7288f9b6f1e5c24be51`.

`postject` prints ELF section-name warnings (`.note.100`/`.note`) on this host; blob generation/injection exits successfully, and executable behavior is checked by the smoke suite. Node 22 prints its experimental MockTimers warning in unit tests. Neither warning is hidden or treated as a failed assertion. Packaging for Windows/macOS, cross-target runtime downloads, and non-x64 Linux testing are outside M0 and unsupported by the current packaging CLI.

**Dashboard and Worker boundary**

The responsive overview supports the system light/dark preference and shows CPU, RAM, swap, load, uptime, hostname/OS, connection state, source errors, and update age/staleness. CPU warming up and unavailable values display a dash with an explanation. Future process/task/event sections are visibly marked M1. There are no control buttons for Worker or OS operations.

Worker format verification: **none**. Only directory metadata is checked at startup, from env/CLI configuration or the existing conventional location. An absent conventional directory means Not configured. A configured missing/inaccessible directory or an existing unverified directory means Unavailable. No existence check is promoted to RUNNING. Worker timestamps remain null. No files, secrets, prompts, transcripts, commands, credentials, claims, checkpoints, or event data are read. Fixtures with deliberately sensitive content remain byte-identical after snapshot requests and never appear in responses. Full file-root/symlink containment, schema validation, freshness, and identity attribution remain M1 work because M0 has no Worker-file reader.

No UI screenshot is supplied: browser inventory was empty in this session. Production HTML/assets and the Vite frontend/proxy were fetched successfully over real HTTP, and Vue SFCs typechecked/built. Visual appearance, narrow-screen layout, and browser console behavior remain unverified; no synthetic screenshot is represented as runtime evidence.

**Security verification**

Automated checks cover foreign/malformed Host rejection, cross-site and same-site API rejection, exact Origin checks, session requirements for snapshot/lifecycle, invalid/Unicode/previous-instance tokens, cookie flags, hardened headers, production CSP, missing API/assets, extensionless navigation, malformed/encoded traversal paths, sanitized collection errors, read-only fixture integrity, and SSE disconnect cleanup/caps. Early router errors also receive sanitized bodies and the same hardening headers, including before normal request hooks run. Asset serving uses only the embedded allowlist, with no arbitrary path reader. There are no remote assets or runtime model/telemetry integrations. The only runtime subprocess operation is the OS browser opener; second-instance detection calls only the local health endpoint.

The health/session bootstrap exemptions are explicit; they expose no machine or Worker state. Production CSP excludes inline scripts/styles. Vite dev headers allow its local HMR WebSocket and injected styles; those development exceptions are absent from production responses. Local HTTP cookies are not marked Secure because the app serves local HTTP.

**Executed verification**

| Check | Node 24.14.0 | Node 22.23.4 |
|---|---|---|
| `npm run typecheck` / package's strict check | PASS | PASS |
| `npm test` | 26 passed, 0 failed, 0 skipped | 26 passed, 0 failed, 0 skipped |
| `npm run build` / package's production build | PASS | PASS |
| `npm run package` | PASS | PASS |
| `npm run test:smoke` | 7 passed, 0 failed, 0 skipped | 7 passed, 0 failed, 0 skipped |

The smoke suite covers embedded assets away from source, real CPU/RAM and revisions, headless tab-close persistence, dev startup/proxy/PORT override/shutdown, SEA first-tab/multiple-tab/refresh/last-tab behavior, browser suppression/default invocation, same-app forwarding, unrelated collisions, real SSE heartbeat/disconnect, and CPU/RSS sampling. Earlier failed assertions during development were fixed and rerun; the table records final results, not the earlier attempts. There are no skipped tests masking deferred M1 functionality; those features are explicitly absent rather than claimed as tested.

Docker Compose configuration validation, multi-stage image build, and `npm run test:docker` passed. The temporary test container ran without networking, host mounts, privileged flags, or published ports; it verified non-root execution, `/app` containing only `server.cjs`, health, assets, session-protected lifecycle, and continued operation after tab closure. The container was removed. No full host-monitoring claim is made for Docker.

**Measured resource use**

Backend bundle only, one client requesting snapshots once per second with one lifecycle SSE in the active phase. Each phase is about three seconds, using Linux process CPU ticks and RSS pages with host `CLK_TCK`/page size. Percent is relative to **one CPU core**. Browser resource use is excluded. These short samples are observations, not performance guarantees; zero means no additional CPU tick was observed at this resolution.

| Runtime / phase | CPU (% one core) | End RSS | Peak sampled RSS |
|---|---:|---:|---:|
| Node 24 idle | 0.00% | 60.30 MiB | 60.30 MiB |
| Node 24 active | 0.33% | 60.55 MiB | 60.55 MiB |
| Node 22 idle | 0.00% | 59.18 MiB | 59.18 MiB |
| Node 22 active | 0.33% | 59.18 MiB | 59.18 MiB |

Raw measurements are retained in `build/resources-node24.json` and `build/resources-node22.json` (generated/ignored). SEA behavior is verified separately; the resource table measures the ordinary backend bundle rather than asserting SEA/browser memory equivalence.

**Outstanding items and next steps**

1. Operator confirms/registers the provisional port block or supplies the official allocation. Update the single config source and regenerate Compose if it changes. No external registry write is authorized or performed.
2. Review M0 and, when satisfied, explicitly approve M1. No M1 implementation will begin before that approval.
3. After approval, obtain approved redacted actual W4/W4.1 state examples and schema/version/filename documentation. Implement validated, contained read-only adapters only for verified formats.
4. M1 then adds identity-safe process observation, freshness/offline handling, bounded monitoring-data SSE/resynchronization, and verified task/checkpoint/event views with their focused tests.
5. Verify the UI in an available browser and capture desktop/narrow-screen screenshots. Broader distribution/OS compatibility and long-duration performance remain future validation.

Run now: `./dist/mx-monitor-tool --no-open`, then open the displayed local URL. Stop with SIGINT/SIGTERM or, after a lifecycle tab has connected, close the last tab and wait two seconds. No monitoring process is intentionally left running after verification.
