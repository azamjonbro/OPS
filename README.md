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

## Getting a usable system

```bash
# 1. a database that supports transactions (production must be a replica set)
npm run probe-transactions -w @hadiya/api

# 2. the first account, once per deployment
npm run create-owner -w @hadiya/api -- --username owner --password '<strong password>' --name 'Owner'

# 3. sign in
curl -X POST http://127.0.0.1:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"<strong password>"}'
```

Sales and stock transfers write several documents at once and use a MongoDB transaction. On a
standalone `mongod` transactions do not exist, so the API logs a warning at start-up and performs
those writes non-atomically — fine locally, **not acceptable in production**.

## Billz integration

Read-only, and reachable only through `apps/api/src/modules/billz`: no controller, no other module
and no future AI code talks to Billz directly. The layering is
`module service -> Billz service -> Billz HTTP client -> Billz API`, and everything crossing the
module boundary is normalised — money in minor units, `externalId` rather than `id`, no snake_case.

Set `BILLZ_API_TOKEN` to switch it on; without it the endpoints answer `503` and report themselves
as unconfigured rather than failing obscurely. Reading requires the `manager` role, running a sync
requires `admin`.

`npm run dev` does not sync anything on its own. A sync is triggered explicitly
(`POST /api/v1/integrations/billz/sync`), runs in the background, and is followed through
`GET /api/v1/integrations/billz/sync/{state,logs}`. It is idempotent: records are matched through
an external-ID mapping table, so re-running changes nothing that has not changed upstream.

[docs/billz-api.md](docs/billz-api.md) lists every endpoint used, the evidence for it, and the
capabilities Billz does not expose to an API key (expenses, sales reports, warehouses, suppliers).

## Assistant, conversations and memory

Conversations, messages and long-term memory are implemented and are **strictly per-user**: every
query is scoped to the signed-in employee in the service layer, so one person's threads and
memories are invisible to another regardless of what a client asks for.

The assistant runs through `POST /api/v1/ai/chat`. It persists the question, builds a **bounded**
context (a window of recent turns plus the memories relevant to the question — never the whole
history), calls the model, and runs any tools the model asks for through the tool registry. Memory
tools (`remember_information`, `get_memory`, `forget_information`) are the only route from a
conversation to stored memory; there is no general "write a record" tool.

Credentials are never remembered: passwords, API keys, tokens, card and account numbers are refused
before anything is stored. Anything the assistant is not confident about is held as `pending` and is
not used until a person confirms it (`POST /api/v1/memory/:id/confirm`).

**A model client is not wired up yet** — that is the assistant phase's job. Until one is registered,
`/ai/chat` answers `503` rather than inventing a reply; everything below it is complete and tested
against a scripted provider.

## What is not implemented yet

Reports, reminders,
content and image generation, notifications and audit logs are **not built**. They are declared in
`APP_MODULES` (`packages/shared`) and mount into `apps/api/src/modules/index.ts` as they are added.

The web client is still the Phase 0 shell: the router guard is implemented but switched off until
`VITE_AUTH_ENFORCED=true`, and no business screen has been built against these endpoints yet.

See [docs/architecture.md](docs/architecture.md) for the reasoning behind these choices.
