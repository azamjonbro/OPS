# Hadiya 2.0

Business management and point-of-sale platform with an AI assistant at its core.

This repository holds the **foundation** of the rebuild: a typed monorepo, a production-shaped
HTTP API, and an application shell for the web client. No business module is implemented yet —
the goal of this phase is that every later module (sales, inventory, Billz, AI agents, memory,
reminders, reports) can be added without reworking the plumbing.

## Stack

| Layer      | Choice                                                             |
| ---------- | ------------------------------------------------------------------ |
| Web client | Vue 3, Vite, TypeScript, Tailwind CSS v4, Pinia, Vue Router, Axios |
| API        | Node.js, Express 5, TypeScript, Mongoose, Zod, Pino                |
| Shared     | Types, constants, Zod schemas and utilities used by both           |
| Tooling    | npm workspaces, ESLint (flat config), Prettier, Vitest             |

## Directory structure

```
hadiya/
├── apps/
│   ├── api/                  # HTTP API
│   │   └── src/
│   │       ├── config/       # env loading, validation, typed config object
│   │       ├── core/         # framework-level building blocks
│   │       │   ├── db/       # connection, schema factory, base repository
│   │       │   ├── http/     # ApiError, response envelope, error mapper
│   │       │   ├── lifecycle/# graceful shutdown
│   │       │   ├── logger/   # Pino logger with redaction
│   │       │   └── middleware/# context, logging, validation, errors, rate limit
│   │       ├── modules/      # feature modules (health today, the rest later)
│   │       ├── routes/       # route table: /health and /v1
│   │       ├── app.ts        # Express app factory (no network)
│   │       └── main.ts       # bootstrap: db → server → shutdown hooks
│   └── web/
│       └── src/
│           ├── components/   # layout + reusable UI
│           ├── composables/  # reusable reactive logic
│           ├── config/       # env access, navigation definition
│           ├── layouts/      # AppLayout (sidebar shell), AuthLayout
│           ├── pages/        # route targets
│           ├── router/       # routes + auth guard
│           ├── services/     # HTTP client and per-domain API calls
│           ├── stores/       # Pinia stores
│           ├── types/ utils/ # shared front-end types and helpers
├── packages/
│   └── shared/               # contract shared by api and web (@hadiya/shared)
├── docs/architecture.md      # decisions made in this phase
└── .env.example              # canonical environment reference
```

## Local setup

Requirements: **Node.js ≥ 22.12**, **npm ≥ 10**, and a reachable **MongoDB** instance.

```bash
npm install
cp .env.example .env
npm run build:shared
npm run dev
```

`npm run dev` starts three processes: the shared package in watch mode, the API on
`http://127.0.0.1:4000`, and the web client on `http://localhost:5173`. The Vite dev server
proxies `/api` to the API, so the browser only ever talks to one origin.

Verify the API:

```bash
curl http://127.0.0.1:4000/api/health
```

## Environment variables

All variables are documented in [`.env.example`](.env.example); copy it to `.env`. The API reads,
first definition winning and never overriding the real process environment:

```
apps/api/.env.<NODE_ENV>.local → apps/api/.env.local → apps/api/.env → ./.env
```

The web client reads `VITE_*` variables from the repo root (`apps/web/vite.config.ts` sets
`envDir`). Only `VITE_*` values reach the browser.

Configuration is validated with Zod at startup (`apps/api/src/config/env.ts`). A missing or
malformed value stops the process immediately with a per-variable message instead of failing on
the first request that needs it. In production, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
(≥ 32 characters) and `CORS_ORIGINS` are mandatory.

Secrets are never committed. `.env*` is gitignored except `.env.example`, and
`.githooks/pre-commit` blocks staged `.env` files and common API-key patterns
(enable with `git config core.hooksPath .githooks`).

## Development commands

Run from the repository root:

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | shared (watch) + API + web, concurrently   |
| `npm run dev:api`   | API only, with reload                      |
| `npm run dev:web`   | Web client only                            |
| `npm run build`     | Builds shared → API → web                  |
| `npm start`         | Runs the compiled API from `apps/api/dist` |
| `npm run typecheck` | `tsc`/`vue-tsc` across every workspace     |
| `npm run lint`      | ESLint over the monorepo                   |
| `npm run format`    | Prettier write (`format:check` to verify)  |
| `npm test`          | Vitest in every workspace                  |
| `npm run verify`    | format:check → lint → typecheck → test     |

## API surface

Operational endpoints are unversioned so probes never follow a version bump; business endpoints
live under `/api/v1`.

| Endpoint                | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `GET /api/health`       | Full health payload; `200` when usable, `503` when a required dependency is down |
| `GET /api/health/live`  | Liveness — the process is running. Never touches a dependency                    |
| `GET /api/health/ready` | Readiness — every required dependency is usable                                  |

Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": { }, "meta": { "requestId": "…", "timestamp": "…" } }
// failure
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…" }, "meta": { } }
```

`requestId` is taken from an inbound `x-request-id` header or generated, echoed in the response
header, attached to every log line for that request, and returned in `meta` — so a user-reported
failure can be traced to its logs.

## What this phase does not include

Authentication, users, employees, branches, products, inventory, sales, customers, payments,
expenses, reports, the Billz integration, AI assistant/tools/memory, conversations, reminders,
content and image generation, notifications and audit logs are **not implemented**. They are
declared in `APP_MODULES` (`packages/shared`) and mount into `apps/api/src/modules/index.ts`
as they are built. The web login page and `authService` call the agreed endpoint paths, which
return `404` until the auth module exists; the router guard is written and switched on with
`VITE_AUTH_ENFORCED=true`.

See [docs/architecture.md](docs/architecture.md) for the reasoning behind these choices.
