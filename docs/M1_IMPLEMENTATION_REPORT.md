# M1 implementation report — 2026-10-23

**Delivery:** M1 implements the real-time monitoring dashboard on the existing M0 foundation. No commit, push, release publication, external-project modification, Worker startup/control, or real agent/model invocation was performed. Stop at this milestone for operator review.

The four requested documents were read. Actual M0 source and its 26 tests were audited before implementation. This directory is not currently a Git repository, so changes were tracked against a project-local M0 source archive and hash manifest rather than claiming a clean Git diff. The supplied architecture, original brief, M1 brief, and historical M0 report remain unchanged.

**Implemented behavior**

The Vue dashboard has working Overview, Processes, Tasks / Checkpoints, and Events navigation, preserving the M0 palette and system theme. It displays real machine CPU/RAM/swap/load/uptime; separate transport and Worker status; timestamps, age and partial/error conditions; verified run/step/requested model; a collapsible focused process tree; feature/task filters; checkpoint detail/history; and event severity/type filters. Refresh and all other controls are display-only.

The backend independently reads verified Worker persistence formats and targeted Linux proc observations. Persisted BUSY cannot become live BUSY without matching the exact PID/start-tick/boot identity and a fresh heartbeat. Missing data, permission failures, malformed records, unsupported versions, stale heartbeats, zombies, PID reuse and orphaned recorded agents have explicit states. Actual retries are not inferred from the Worker's failure counters, and requested models are never labeled as independently verified actual models.

Authenticated `/api/stream` now carries real-time monitoring updates. `/api/lifecycle` remains a separate authenticated tab-lifetime stream. One shared collection/cache serves all subscribers. Native EventSource reconnects resynchronize with a full snapshot; frontend ordering guards handle duplicates, out-of-order frames and backend restarts. No periodic frontend snapshot polling remains.

**Changed file tree** (`+` added, `~` updated; other M0 files retained):

```text
~ .dockerignore
~ AGENTS.md
~ README.md
~ package.json / package-lock.json
~ shared/api.ts
~ shared/config.ts
  backend/
  ~ main.ts
  ~ runtime.ts
  ~ server.ts
  ~ security.ts
  ~ monitor.ts
  ~ worker-location.ts
  + observation.ts
  + monitor-stream.ts
    collectors/
    + processes.ts
    + worker-state.ts
    worker/
    + files.ts
    + validation.ts
    + parsers.ts
    + events.ts
    + summary.ts
  frontend/src/
  ~ App.vue
  ~ styles.css
  + monitor-state.ts
    composables/
    ~ useMachineDashboard.ts
    + useMonitorStream.ts
    components/
    + OverviewDashboard.vue
    + WorkerStatus.vue
    + ProcessTree.vue
    + TaskList.vue
    + EventTimeline.vue
    + SourceNotice.vue
    + StatusBadge.vue
  scripts/
  ~ smoke.ts
  ~ docker-smoke.ts
  + ui-smoke.ts
  + observe.ts
  tests/
  + fixtures/worker.ts
  + processes.test.ts
  + worker.test.ts
  + events.test.ts
  + encoded-security.test.ts
  + stream.test.ts
  + monitor-config.test.ts
~ docker/app.Dockerfile
~ docs/architecture.md
~ docs/worker-state-compatibility.md
+ docs/M1_IMPLEMENTATION_REPORT.md
```

The single manifest/config, dependency direction, Fastify factory, Vite root, embedded placeholder, and build/SEA pipeline are preserved. `lifecycle.ts`, `page-lifetime.ts`, OS opener, dev supervisor, and SEA build/package helpers retain M0 behavior. The security hook is additionally hardened against encoded-route authentication bypass. All four original M0 test files are byte-identical to the pre-M1 archive. Build/dependency/cache/fixture/render/measurement artifacts remain under ignored `build/`, `dist/`, or `node_modules/`. No Worker directory is created.

**Dependencies and versions**

Only one direct development dependency was added: `@vue/server-renderer` 3.5.44, already present transitively through Vue, now declared explicitly for component verification. Fastify remains the sole direct production dependency. No additional runtime monitoring library, Python backend, database, or test framework was introduced.

| Dependency | Exact version | Use |
|---|---|---|
| fastify | 5.12.7 | Backend dependency |
| vue | 3.5.44 | Bundled frontend |
| vite | 8.3.5 | Frontend/dev tooling |
| @vitejs/plugin-vue | 6.0.10 | SFC tooling |
| @vue/server-renderer | 3.5.44 | Component verification only |
| typescript | 5.9.3 | Strict checking |
| vue-tsc | 3.3.13 | Vue checking |
| @types/node | 22.20.5 | Node types |
| esbuild | 0.28.2 | Backend bundle |
| tsx | 4.23.15 | TypeScript scripts/tests |
| postject | 1.0.0-alpha.6 | SEA injection |

The lockfile records transitive dependencies. Docker's executed `npm ci` audit reported zero vulnerabilities at verification time. No separate lint configuration exists; lint is not claimed as executed. Strict typechecking and the focused test suites were executed.

**Verified external formats and read-only boundary**

Adapter identifier: **`mx-feature-worker/w4-v1`**, derived from the local W4/W4.1/W4.2 implementation in `../mx-admin-cloud/scripts/feature_coordinator/`, not guessed from sample names. Primary sources: `store.py`, `autonomy.py`, `locks.py`, `checkpoints.py`, `model.py`, `claims.py`, `service.py`, `config.py`; `workflow.py` and `native_backend.py` additionally establish claim/agent progress identity. The coordination `worker-autonomy.md` document explains W4.1/W4.2 behavior. No Python Worker module or CLI was executed.

| Record family | Verified format |
|---|---|
| Service | `service/worker.json`, schema 1 |
| Features | `features/<id>.json`, schema 1 |
| Tasks | `tasks/<id>.json`, schemas 1 and 2; v1 explicitly has no steps |
| Claims | `claims/<task>.json`, verified unversioned `Claim.to_dict` shape |
| Checkpoints | `checkpoints/<task>.json`, schema 1 |
| Scheduling | `scheduling/<task>.json`, schema 1 |
| Events | `events.jsonl`, verified unversioned `{at, kind, ...}` writer plus known event-kind allowlist |

Only those paths are opened. Auth/credential/transcript/prompt/run/config/lock/GitHub/outbox/control files are not read. Unselected prompt-like task fields, claim tokens/run tags/directories, checkpoint file manifests/summaries/local paths, raw event payloads and full commands/environments never reach DTOs or logs. Free-text attention/blocking/service reasons are scrubbed and bounded; event summaries are fixed allowlisted text. Model/provider labels are constrained and requested models remain explicitly recorded values.

State IO uses read-only, nonblocking, no-follow opens through pinned Linux directory FDs. Record IDs and kinds are allowlisted. Symlink roots/components/files, traversal, hard links, special files, over-limit records and excessive JSON nesting are refused. Directory replacement cannot redirect an already pinned root to a new symlink target. Atomic file replacement is read safely without locks; unavailable/corrupt data is marked, last-known task data is explicitly stale, and later successful reads recover.

`build/m1-external-source-proof.json` compares **eight primary Worker source files** hashed before implementation against their final bytes: **all eight unchanged**. This is proof for those audited sources, not a claim to have hashed every external repository file. The tool execution made no writes to the external project. Fixture integrity tests hash all fixture bytes and directory members before/after HTTP snapshots and live SSE; those remain identical.

**API, freshness and transport contract**

All DTOs and stream envelopes are defined in `shared/api.ts`; identity, ports and shared limits derive from `shared/config.ts`. The snapshot schema remains additive version 1, with revision and UTC timestamp, machine, Worker, feature/task/process/event sections and diagnostics. Source status retains M0's `lastSuccessfulAt` naming and adds age/live-identity metadata. Missing timestamps are null; absent/unverified metrics are not turned into zero.

| Endpoint | Contract / access |
|---|---|
| `GET /api/health` | Minimal public app identity/version/dev probe; Host/origin checked |
| `GET /api/session` | Same-origin session bootstrap; random per-start HttpOnly, SameSite=Strict cookie scoped to `/api` |
| `GET /api/snapshot` | Authenticated full sanitized current snapshot |
| `GET /api/stream` | Authenticated monitoring SSE; full initial snapshot, subsequent shared snapshots, heartbeat |
| `GET /api/lifecycle` | Authenticated dedicated tab-lifetime SSE, unchanged M0 behavior |

Monitoring envelopes contain `schemaVersion`, monotonic `sequence`, per-server UUID `serverId`, UTC `at`, and the full snapshot. Every new/reconnected connection receives a full snapshot; Last-Event-ID does not request replay. Sequence/revision checks reject old frames; a changed server UUID resets ordering. Native EventSource automatic reconnect is retained, and M0 lifecycle bootstrap renews the cookie after backend restarts. Tokens are never placed in URLs.

The broadcaster reserves subscriber capacity while an initial collection is pending, but broadcasts only to clients whose hardened SSE headers have been sent. A deterministic regression covers joining during an in-flight shared collection. Disconnected/broken/slow writers cannot accumulate an application-side history queue; the Node output queue has an explicit bound. The shared collection and heartbeat timers stop after the final monitoring disconnect. Shutdown closes all streams and waits for pending work. Snapshot requests without subscribers collect on demand; idle monitoring does not retain a polling interval.

Defaults: machine/service/process/event collection about 1 s; task/checkpoint/scheduling reads about 2 s. Env options validate configurable cadence and service freshness. Service staleness defaults to 90 s, matching 3 × the inspected Worker's default 30 s heartbeat; its actual config is not read. Claim quietness uses the inspected 120 s default and is an observation only. Collection has a cooperative 500 ms file budget, 200 ms process traversal budget, and bounded counts/sizes/depth. Already-running kernel IO cannot be forcibly interrupted.

**Linux correctness and limits**

M0 machine collection retains `/proc/stat` CPU deltas, separate load averages, MemAvailable-based RAM, swap and uptime. Process stat parsing handles spaces and parentheses in `comm`, validates numeric fields, and uses successive process ticks over elapsed time rather than lifetime counters. Tick/page constants come from local `self/auxv`; boot UUID comes from the kernel boot-ID file. No external command is needed at runtime. The [Linux proc documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) informed the collector boundaries.

Process attribution requires each record's complete identity, not PID alone. A regression covers service/claim records sharing a PID but differing in start time: a valid identity in one record cannot prove another record alive. Verified descendants must match parent/start evidence; unrelated same-named processes are not scanned or included. Missing, denied, replaced, zombie and orphan evidence stays explicit. Traversal checks time between individual child reads.

Limits: 128 tasks; 64 features; 64 process rows/depth 4; 100 recent events; 512 dedup fingerprints; 256 KiB per JSON record; JSON nesting 16; 128 KiB event read/cycle; 16 KiB event line; 32 monitoring subscribers; **4 MiB output queue/client**. Checkpoint source records cap at 256; display caps at 20/task and 400/snapshot. Limits/partial results are visible and incomplete counts become null when unsupported by the available evidence.

**Actual and synthetic demonstrations**

Real native Linux sample at **2026-10-23T10:03:57.219Z**: CPU **3.55%**, load **2.7 / 2.36 / 1.55**, RAM used **15.28 GiB**, available **15.79 GiB**, total **31.07 GiB**, **32** logical CPUs available. The warm CPU sample comes from successive real kernel counter reads, not load average. The complete sanitized observation is in `build/real-machine-m1.json`; read-only state fingerprints are in `build/worker-observation-m1.json`.

The conventional Worker root existed, with empty feature/task directories and no service/checkpoint/scheduling/event records. Its real status is **UNAVAILABLE**, directory available, no live identity verified. No actual populated W4.2 run was found in the documented default smoke location, and no alternative root was supplied during implementation. This is not presented as evidence of a running Worker. `test:observe` fingerprinted **0** eligible state files and recorded unchanged before/after results; with an empty root that does not prove populated real-state parsing. Populated parsing is verified using synthetic fixtures matching the inspected writers.

Fixture demonstrations cover fresh BUSY with verified Worker/launch/agent/child identities, OFFLINE despite persisted BUSY, STALE heartbeat, UNKNOWN/inaccessible identity, orphaned agents, PID reuse, conflicting identities, dependencies, checkpoint supersession/history, waits/attention and sanitized events. SEA smoke tests run a schema-matched stopped fixture and stream real host CPU/RAM updates; no fake process is launched and no model session is used.

Rendered component artifacts (not browser screenshots):

- [Real-machine overview](../build/ui/real-machine-overview.html)
- [Synthetic overview](../build/ui/fixture-overview.html)
- [Synthetic process tree](../build/ui/fixture-processes.html)
- [Synthetic tasks/checkpoints](../build/ui/fixture-tasks.html)
- [Synthetic event timeline](../build/ui/fixture-events.html)
- [Synthetic stale state](../build/ui/fixture-stale.html)

Synthetic HTML has a prominent fixture label and is not served by the application. The real-machine component artifact labels its observation separately. No graphical browser was available (browser inventory empty), so actual screenshots, interactive browser behavior, layout at narrow widths and browser-console validation remain **unverified**. Vue components were actually compiled/rendered, their empty/error/stale states and escaping checked, and real HTTP/session/SSE/proxy behavior exercised. Client ordering/restart logic has deterministic tests.

**Final verification**

| Check | Node 24.14.0 | Node 22.23.4 |
|---|---|---|
| Strict TypeScript/Vue checking | PASS | PASS |
| Unit/integration tests, original M0 retained | 67 passed / 0 failed / 0 skipped | 67 passed / 0 failed / 0 skipped |
| Component checks | 5 passed / 0 failed / 0 skipped | 5 passed / 0 failed / 0 skipped |
| Production build | PASS | PASS |
| Linux SEA packaging | PASS | PASS |
| Executable/dev/HTTP/SSE smoke | 8 passed / 0 failed / 0 skipped | 8 passed / 0 failed / 0 skipped |

The 67 test cases include the original 26 M0 tests unchanged, plus 41 M1 cases. The eight smoke cases preserve M0 coverage and add standalone real monitoring updates with a stopped schema-matched Worker. Earlier development failures were corrected and rerun; only final results are counted. The permission test can legitimately skip under root because root bypasses POSIX mode restrictions, but it ran and passed on this host. No tests were disabled to obtain these results.

An inherited M0 authentication flaw was reproduced with `/%61pi/snapshot`: Fastify recognized the encoded route while the old hook classified only the raw `/api/` prefix. M1 now checks the matched route and decoded path, and only matched minimal health/session routes are public. Regression tests verify encoded snapshot/lifecycle/monitoring URLs require sessions and reject cross-site requests. The final M1 executable includes this correction; real HTTP checks against packaged SEA binaries also verify encoded snapshot and both SSE paths return 401 without a session.

Security checks cover foreign/malformed Hosts, exact Origins and cross-site fetches, sessions on both SSE routes/snapshot, random per-start cookie isolation, hardening/CSP/early errors, traversal, symlink/directory replacement/hard-link escapes, record/nesting caps, XSS escaping, secret suppression, byte/tree integrity, identity reuse/cross-record confusion, partial failures, SSE ordering/reconnect/capacity/output limits, shared collection, and timer cleanup. No mutation endpoints or operational Worker controls were added.

Docker Compose config, image build and isolated runtime checks passed. The temporary container runs non-root with no host mounts/PID namespace/privileged options and no network, verifies `/app` contains only `server.cjs`, serves assets/health, authenticates both SSE routes, and stays running after tab close. It is removed after the check. Docker does not claim visibility into the host's Worker/process namespace.

**Build and package artifacts**

The build remains Vite SPA → generated asset map → esbuild CommonJS backend targeting Node 22 → Node SEA blob injected into a copy of the current runtime. The placeholder remains compilable before a build. SEA bakes `STOP_ON_PAGE_CLOSE=true`; Node/dev/Docker remain false. Existing tests verify no shutdown before first tab, multiple tabs, refresh grace, two-second final-tab exit, browser suppression/default opener arguments, signals and safe second-instance detection. Browser invocation uses a controlled stub in tests; an actual graphical browser launch was not verified.

The final delivered native Linux x64 binary uses **Node 22.23.4**. Executable: `dist/mx-monitor-tool`, **126,684,352 bytes** (120.82 MiB), SHA-256 **`565a3f98e55f0ddd52247eb423e3601e1d7d9e1f67bc1fc8886da4b6148e6188`**. Backend bundle: **1,711,629 bytes**. The executable is copied to an empty working directory for smoke verification and does not depend on source, frontend files, package.json or node_modules beside it.

The frontend build is approximately 87.3 kB JS, 10.1 kB CSS and 0.51 kB HTML before compression. `postject` emits the same ELF section-name warnings seen in M0, but packaging exits successfully and generated binaries pass smoke checks. Node 22's MockTimers warning is experimental-test API output, not a failed test. Native Linux packaging only is supported; Windows/macOS/cross-target packaging was not added or claimed.

**Measured CPU/RSS**

Three-second idle and active phases measure the ordinary backend bundle using Linux CPU ticks and RSS pages. Active means one monitoring SSE, one lifecycle SSE and one HTTP snapshot request/second; the configured Worker root is absent in this performance case. No browser cost is included. CPU percent is relative to one core; zero means no additional CPU tick was observed at this resolution. These short samples are observations, not endurance guarantees or a loaded-Worker performance claim.

| Runtime / phase | CPU (% of one core) | End RSS | Peak sampled RSS | SSE subscribers |
|---|---:|---:|---:|---:|
| Node 24 idle | 0.00% | 60.88 MiB | 60.88 MiB | 0 |
| Node 24 active | 0.66% | 61.63 MiB | 61.63 MiB | 1 |
| Node 22 idle | 0.00% | 59.46 MiB | 59.46 MiB | 0 |
| Node 22 active | 0.00% | 59.71 MiB | 59.71 MiB | 1 |

The active diagnostic reports one monitoring subscriber; tests exercise the 32-subscriber cap and 4,194,304-byte output limit. Timers stop after the last subscriber; tests observe collection counts remaining stable after disconnect. Raw samples: `build/resources-m1-node24.json` and `build/resources-m1-node22.json`.

**Limitations and next steps**

The port block **3490–3499 remains provisional**, backend 3490 / Vite 3491. No official registry was available, no external registry was edited, and socket availability is not claimed as a company reservation. Confirm/register it or supply the official block before organization-wide distribution.

Supported Worker formats are the inspected local writer versions; newer schemas are not assumed compatible. Configured heartbeat intervals require corresponding Monitor freshness configuration. Actual model identity is not independently verified. Targeted process observation intentionally cannot discover detached/unrecorded processes; thread-group-leader child lists can omit children created on other threads. Event rotation/truncation uses identity/size/prefix checks; truncate-and-regrow with the exact same checked prefix beyond the prior offset between samples can be indistinguishable from append. Multi-file reads do not take Worker locks or promise an atomic external transaction.

Graphical browser QA and a populated actual W4 state/live-Worker observation were unavailable, not replaced by fake success evidence. The implementation and fixture/native verification are complete within those stated validation limits. No Worker needs to be started to use the dashboard.

Recommended next milestone, only after approval: graphical desktop/narrow-screen QA; read-only checks against an operator-provided actual state root and independently operated Worker; longer observation/resource runs; formal port registration and broader Linux distribution compatibility. No additional milestone, commit, push or external change begins automatically.

Run: `./dist/mx-monitor-tool --no-open`, then open the displayed local URL. Add `--worker-state-dir /path/to/existing/state` for another verified root. No monitoring daemon/container is intentionally left running after verification.

**Operator-requested refinement — process counter (2026-10-23)**

The Processes heading now counts verified live identities as `ACTIVE` and remaining persisted identities as `RECORDED`. One stopped recorded Worker displays `1 RECORDED`; one verified live Worker displays `1 ACTIVE`. Mixed lists display both counts, and an empty list displays `0 RECORDED`. Counting uses the existing per-process `identityVerified` evidence; no collector, Worker-control, authentication or architecture changes were needed.

Added component regression coverage for stopped, live, mixed and empty lists. Follow-up verification on Node 22.23.4: 67 unit/integration tests, 6 component checks and 8 smoke cases passed, with zero failures or skips. Strict typechecking, production build and native SEA packaging passed. Logs are `build/process-counter-{tests,ui,package,smoke}.log`. The full dual-runtime and Docker results above describe the initial M1 verification; those checks were not repeated for this label refinement.

The refreshed `dist/mx-monitor-tool` supersedes the binary checksum above: **126,684,352 bytes**, SHA-256 **`762232551e2b29ee85b6a76f982b9336f7f26c4fb6caa13bd91b58bfdf3d9619`**; ordinary backend bundle **1,711,817 bytes**. The first packaging attempt encountered `ETXTBSY` because the previous executable was running. Its inode was preserved at `build/mx-monitor-tool-before-process-counter`, packaging was rerun successfully, and the existing application was left running. Close and relaunch the updated executable to see the change. No external project changes, Worker control, commits or pushes were performed.
