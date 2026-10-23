# Project boundaries

Read `TS project structure.md`, `MX_MONITOR_TOOL_PROJECT_BRIEF.md`, and `MX_MONITOR_TOOL_M1_IMPLEMENTATION.md` before changing the application. The company architecture governs structure, security, lifecycle, and packaging. **M1 is explicitly approved** for implementation and local verification; stop for operator review after M1.

- Work inside this project. Do not change other projects or the external port registry.
- Never commit, push, or publish without explicit instructions.
- One root package manifest and strict TS config; ESM source; contracts in `shared/`.
- Backend and frontend depend on `shared/`, never on one another. Tooling belongs in `scripts/`.
- Identity and ports originate in `shared/config.ts`; package name must match. Generate Compose with `npm run docker:config` after changes.
- Worker observation is read-only. Verify formats from the approved external Worker source without executing it. Never invent schemas, read credentials/transcripts, or invoke Worker or AI agents.
- The ordinary bundle keeps running after tabs close. SEA always bakes `STOP_ON_PAGE_CLOSE=true` and waits two seconds after the last lifecycle connection closes. Keep lifecycle SSE separate from monitoring SSE.
- Keep security checks in the Fastify factory, including matched-route/decoded-path API classification, Host/origin checks, session-protected snapshots/SSE, hardening headers, and strict asset fallback. Encoded API paths must never bypass authentication.
- Verify with `npm run typecheck`, `npm test`, `npm run test:ui`, `npm run build`, `npm run package`, and `npm run test:smoke`. Docker checks are optional when Docker is unavailable. Confine temporary fixtures and caches to `build/`.
