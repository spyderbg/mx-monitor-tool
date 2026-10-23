# MX Monitor Tool — M1 Implementation Brief

**For Codex CLI** · **Milestone M1: Independent, read-only real-time Linux + Worker Monitoring**

**Target project:** `/home/plamen/_Projects/MarXman/mx-monitor-tool`  
**Technologies:** TypeScript · Node.js · Fastify · Vue 3 · Vite · SSE · Node SEA  
**Reference:** `TS project structure.md` (MarXman Studio Tool App standard), `MX_MONITOR_TOOL_PROJECT_BRIEF.md`, and `docs/M0_IMPLEMENTATION_REPORT.md`.

## 1. Authority and goal

**M1 is approved for implementation and local verification.** Do not stop after planning. Build a **usable** local Web Dashboard that independently monitors **one Ubuntu/Linux machine** and a separately running (or stopped) **MX Feature Worker**, through read-only files and `/proc`.

M0 is reported complete: Fastify/Vue foundation, strict shared TypeScript contracts, security, session cookie and authenticated `/api/lifecycle` SSE, real host CPU/RAM/swap/load/uptime, SEA and Docker packaging, 26 tests + 7 smoke tests per runtime, packaging verified with Node 22.23.4 and 24.14.0. **Verify M0 from the actual source; do not replace or regenerate the project.**

Do not change, import, launch, signal, or write to the Worker; `mx-admin-cloud` is **read-only reference material only**. No real model calls. No GitHub writes. Do not commit/push without a separate approval.

## 2. Initial reconnaissance — do this first

1. Inspect `git status`, `package.json`, `shared/`, `backend/`, `frontend/`, existing tests, and `docs/M0_IMPLEMENTATION_REPORT.md`.
2. Read both company Tool App standard and original Monitor project brief if present. They override guesses about lifecycle, security, packaging and directory layout.
3. Check the project's port assignment: **3490–3499 is provisional** until registered in MarXman's global port registry. Never edit an external registry without permission; retain and visibly document provisional status.
4. Find a local accessible **read-only** W4 Worker implementation and docs, if available (likely in `/media/plamen/data/MarXman/mx-admin-cloud`, but do not presume existence). Study the actual persistence code and data formats in `scripts/feature_coordinator/store.py`, `autonomy.py`, `locks.py`, `checkpoints.py`, `model.py`, and `docs_agents/coordination/worker-autonomy.md`. **Do not run `feature.py`, the Worker service, or CLI commands to obtain data.**
5. If permission allows, inspect allowlisted, nonsecret records in `~/.local/state/mx-admin-agents` without modification, or use carefully anonymized local fixtures matching real schemas. The W4.2 smoke-test runs use a **separate state directory**, not necessarily the default state root.
6. Report any blocking schema ambiguity; do not invent plausible fields or pretend the Worker is running when it is not.

**Known W4 filesystem layout to verify against source (not a substitute for validation):** `service/worker.json`, `features/<id>.json`, `tasks/<id>.json`, `claims/<id>.json`, `checkpoints/<id>.json`, `scheduling/<id>.json`, `flags/worker-control.json`, `events.jsonl`. Some are per-task, others machine-specific. Their actual contents and revisions must be confirmed before writing an adapter.

## 3. Scope — deliver a working M1, not a prototype

### A. Overview Dashboard

Show live, timestamped **machine metrics**: hostname, OS, CPU usage computed from `/proc/stat` deltas, load averages, uptime, RAM total/used/**available**, swap used/total. Keep M0's correct behavior, enhance rather than duplicate it.

Show **Monitor transport** independently from **Worker health**: connected/reconnecting/disconnected; last update age; state directory configured/missing/unreadable; Worker RUNNING/BUSY/WAITING/NEEDS_ATTENTION/STALE/OFFLINE/UNKNOWN according to *validated* evidence. For stopped Worker, distinguish persisted last state from live process state; never display a historical BUSY record as live BUSY.

Show selected feature, active task/step/provider/requested model, session duration, last verified checkpoint, task counts and relevant attention reason **only if source fields actually support them**. Render unknown, unavailable, unsupported and stale as explicit UX states, never fake zeros.

### B. Processes

A focused process tree for confidently attributable Worker-owned processes. Show PID, PPID, process name (sanitized), status, per-process CPU %, RSS and elapsed time, plus validated ownership (`worker`, `launch`, `agent`, `child`, `unverified`). Use `/proc` and evidence of **PID + start time + boot identity** where available; handle PID reuse. Process names alone are *not* ownership evidence. Process identity mismatches must show unverified rather than linked. Bounded traversal/scanning only; tolerate disappearing and permission-denied PIDs. **Do not read process environments or expose full command lines.** Never signal or kill processes.

### C. Tasks / Checkpoints

Parse only verified external schemas. Display feature, task ID, role, task state, dependencies, step progress, checkpoint sequence/commit short SHA, scheduling launch count, retry/wait state and operator-attention reason. Consider schemas unknown unless validated by code and fixtures. Handle missing/partially written/malformed/unsupported records gracefully per section 5. Do not read full prompts, CLI transcripts, secret-bearing details or arbitrary task fields.

### D. Events

A capped timeline of sanitized allowlisted `events.jsonl` fields (type, time, feature/task reference, safe summary, severity if derivable). Live tail incrementally, handle truncation/rotation, incomplete final JSONL line, duplicate events, timestamp disorder and malformed lines. Do not dump raw event payloads to the browser or logs. Offer basic local filters. No persistent DB.

### E. Live SSE

Keep the standard authenticated `/api/lifecycle` stream for page-lifetime management. Add a **separate**, authenticated `/api/stream` stream for monitoring snapshots/events, with same-origin cookies, bounded memory, heartbeat, monotonically increasing event sequence, source timestamps, and deterministic client resynchronization after reconnect (e.g. initial full snapshot). Use existing M0 security hooks. Initial `GET /api/snapshot` returns the same typed, sanitized snapshot. Guard backpressure, disconnected clients and timer cleanup. Don't start a new expensive collector for every browser tab: share collection results across subscribers.

## 4. Data contracts and architecture

Keep one root `package.json` and one strict `tsconfig.json`. Define API, status/freshness and SSE envelope types in `shared/api.ts` (or adjacent `shared/` files) and reuse them in Fastify and Vue; validate *runtime* input before constructing the DTOs.

Separate small modules: Linux machine collector, process collector, read-only versioned `WorkerStateAdapter`, checkpoint/task parsing, event tailer, snapshot aggregator, SSE broadcaster, focused Vue views and composables. Use the M0 Fastify `createServer()` factory; keep backend imports independent of frontend. No Python backend or calls to Worker CLI.

Worker state directory configured via existing M0 convention (`MX_MONITOR_TOOL_WORKER_STATE_DIR`, if implemented) and/or validated CLI option. Fallback to `~/.local/state/mx-admin-agents` **only if already present**. Never create it. Read only explicit allowlisted paths within that root; reject traversal, symlink escapes and unexpected file kinds. Bound file sizes/counts, scan time and JSON nesting. Do not take Worker locks. Tolerate concurrent atomic record replacements. No recursive free-form filesystem API.

Source freshness must be explicit per source: status, observedAt, lastSuccessAt, age, sanitized error, and *whether live identity was verified*. Missing data should not make the whole Monitor fail.

Collection cadence (configurable, with CPU budget): machine/verified processes/Worker heartbeat approximately 1 s; task/checkpoint summary approximately 2 s; tail events incrementally. Keep event history and in-memory trend samples bounded. Avoid repeated `git` subprocesses or deep scans of all `/proc` on every tick.

## 5. Security and independence — non-negotiable

- Read-only means zero modification to external Worker: no writes, mkdir, chmod, signal, CLI launch, claim/lock access requiring mutation, process priority changes, or Git changes in other repos.
- Never call Claude Code, Codex, paid AI services, GitHub or remote telemetry at runtime. No ability to operate Worker from UI. Only UI navigation, sorting, filtering and refresh are allowed.
- Preserve Fastify loopback binding, Host/origin restrictions, strict SPA fallback, per-start HttpOnly Strict cookie, security headers/CSP, and M0 SEA last-tab shutdown semantics. `/api/snapshot` and `/api/stream` must be authenticated.
- Don't expose env vars, CLI secrets, auth paths/files, complete process command lines, full prompt/transcripts or arbitrary event fields. Sanitize free text and error messages.
- Collectors must still work with Worker absent/offline/corrupt; errors are isolated and show truthful source status.
- Container packaging stays available but **must not claim visibility into host Worker processes without explicit opt-in host mounts/namespaces**. The MVP should run natively on Linux.
- Keep SEA-only `STOP_ON_PAGE_CLOSE=true`, last-tab 2 s grace and no premature exit before first tab. Ordinary Node and headless Docker builds keep existing behavior.

## 6. UI quality

Build an actual, polished desktop-first Vue dashboard in the existing MarXman style without changing the palette or overall M0 design unnecessarily:

- **Overview**: health/connection indicators, resource cards, Worker summary, active run/step, last update.
- **Processes**: focused collapsible worker-attributed process tree with meaningful unavailable/unverified labels.
- **Tasks & Checkpoints**: compact state badges and per-task progress, details panel showing checkpoint history.
- **Events**: filtered live timeline, bounded to recent events.

Readable on small screens. Handle Worker missing, Worker stopped, stale heartbeat, partial permissions, empty tasks, corrupt files and lost SSE connection. If graphical browser validation is available, capture screenshots; otherwise label it unverified and exercise HTTP/DOM/component checks. Avoid decorative invented data and fake historical charts; optional sparklines may use real in-memory samples only.

## 7. Acceptance tests (required)

Implement deterministic tests with synthetic fixtures **matching verified real schemas**, fake `/proc` and injectable clocks where needed. Also include optional read-only observational checks against actual nonsecret Worker state if accessible.

1. **No Worker:** Monitor boots with missing/unreadable state dir, remains functional and correctly displays no live Worker.
2. **Read-only integrity:** snapshot, polling, SSE and UI fetches leave Worker fixture bytes and tree structure unchanged; test with hashes before/after.
3. **Linux metrics:** CPU deltas vs load average, MemAvailable, swap, boot ID, process stat with spaces/parentheses, vanishing PID and EACCES.
4. **Ownership:** PID reuse/mismatched process start time, false name matches, orphan/unverified paths and correctly linked process trees.
5. **Worker parsing:** valid, unsupported, stale and malformed records; partial/missing fields; no false LIVE from a stale service record.
6. **Tasks/checkpoints/events:** verified parsing, partial JSONL line, rotation/truncation, bounded recent entries, redaction, no unsafe raw-field propagation.
7. **SSE:** auth/session, initial full snapshot, ordered revisions, heartbeat, reconnection resync, slow client behavior, cleanup of timers and subscribers.
8. **HTTP security:** invalid Host/origin, cross-site requests, unauthenticated API/SSE, path traversal, symlink escapes, file size limits, XSS strings in events.
9. **Desktop lifecycle:** no regression in M0 `lifecycle` SSE and SEA last-tab shutdown; ordinary Node/Docker unaffected.
10. **Packaging:** Node 22 and 24 typechecks and tests when available, `npm run build`, `npm run package`, executable smoke, SPA asset delivery, and headless Docker tests if available.
11. **Performance:** real observation of idle/active CPU, RSS, SSE subscriber counts and buffer limits; no leaked polling timers or processes.

Keep M0 tests; do not weaken or skip them to make M1 pass. If any test cannot run, report it and why. No real AI model session is necessary to test the Monitor.

## 8. Execution plan and completion rules

1. **Audit M0** and external Worker formats (read-only); briefly state design plan.
2. Implement and test **read-only collectors/adapters** and freshness handling.
3. Implement `GET /api/snapshot` + authenticated `/api/stream` without breaking `/api/lifecycle`.
4. Build Vue Overview/Processes/Tasks/Events and handle disconnected/stale/empty states.
5. Run full tests, lint/typecheck, both Node runtimes when feasible, build, Linux SEA smoke and relevant Docker packaging.
6. Write `docs/M1_IMPLEMENTATION_REPORT.md`, update README and `docs/worker-state-compatibility.md` with actual verified state version(s), source paths, limitations and configuration.
7. Show at least one **real machine** sample. Show a real Worker example **only if available and validated**. Otherwise show the real OFFLINE/UNAVAILABLE UI and include tests against schema-matched fixtures, clearly separated from real-machine evidence.

**Definition of done:** Launching the built `mx-monitor-tool` standalone on Ubuntu gives a genuinely working, authenticated, responsive SSE Web Dashboard with correct live machine metrics and independently parsed read-only Worker state **when present**; it gracefully reports offline/missing/unknown Worker and never affects Worker operation. Existing M0 conventions and SEA packaging still work.

**Do not call this milestone complete just because the page loads.** Verify real data updates and correctness of status, process attribution, task/checkpoint state, event sanitization and reconnect handling.

**Final report:** changed file tree, verified Worker source/schema and version, API/SSE contracts, UI screens, live/fixture demonstration, external read-only proof, tests pass/fail/skip counts, Node versions, build/SEA/Docker results, RAM/CPU measurement, security findings, limitations, port registration status, and recommended next milestone.

Stop after M1 implementation and local verification. **Do not commit, push, or change any external project without separate approval.**
