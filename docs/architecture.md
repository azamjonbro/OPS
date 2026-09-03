# Architecture — Phase 0 (foundation)

This document records the decisions made while building the Hadiya 2.0 foundation and the
constraints they place on later phases. It describes what exists today; it is not a roadmap.

## 1. Monorepo with npm workspaces

Three workspaces: `apps/api`, `apps/web`, `packages/shared`.

The API and the web client are one product with one release cycle, and they share a wire format.
Keeping them in one repository means a change to a response shape and its consumer land in the
same commit. npm workspaces were chosen over pnpm/Turborepo because the dependency graph is
small (shared → api, shared → web) and npm ships with Node — no extra tool to install or pin.

`@hadiya/shared` is consumed as a built package (`dist` + `.d.ts`), not through path aliases into
another workspace's source. That keeps the boundary honest: the API cannot reach into a web-only
helper, and the shared package has to compile on its own. `npm run build:shared` therefore runs
before typechecking or building the apps.

**What belongs in `shared`:** the wire contract (response envelope, pagination, health, auth
payloads), vocabulary (`USER_ROLES`, `APP_MODULES`), validation schemas used by both sides, and
pure utilities (`resolvePagination`, money conversion, object-id matching). Anything that needs
Express, Mongoose, Vue or the DOM does not belong there.

## 2. API: modules on top of a thin core

```
routes → controller → service → repository → model
```

- **`core/`** is framework-level and business-free: HTTP primitives, database access, logging,
  lifecycle, middleware. It is written once and reused by every module.
- **`modules/<name>/`** is one capability, self-contained. `health` is the reference
  implementation: `health.routes.ts` wires paths, `health.controller.ts` translates HTTP to and
  from the service, `health.service.ts` holds the logic and knows nothing about Express.
- **Route files contain no logic.** They map a path and its validation schemas to a controller.

New modules are registered in `apps/api/src/modules/index.ts` by pushing an `ApiModule`
descriptor (`name`, `basePath`, `router`). `routes/index.ts` mounts every registered module under
`/api/v1`; nothing else changes. `ApiModule['name']` is typed as `AppModule`, so a module cannot
invent a capability name that permissions and audit logs do not know about.

**Repositories** exist even though no collection is modelled yet, because every later module will
need the same bounded reads. `BaseRepository<TDocument>` provides `create`, `findById`, `findOne`,
`exists`, `count`, `list` (paginated), `updateById` and `deleteById`, returning plain objects via
`.lean()`. Services depend on repositories, never on Mongoose models directly, so a collection can
later gain caching or an aggregation pipeline without touching business logic.

**`createSchema`** fixes `timestamps`, `versionKey: false` and a `toJSON`/`toObject` transform that
renames `_id` to a string `id` and drops `__v`. Persistence details therefore never reach the wire,
and no model file repeats the same options. It accepts only the narrow subset of Mongoose options a
module may legitimately override.

## 3. One response envelope, one error path

Every successful response is `{ success: true, data, meta }` and every failure is
`{ success: false, error: { code, message, details? }, meta }`, with `meta.requestId` and
`meta.timestamp`. The types live in `@hadiya/shared`, so the API cannot change the shape without
the web client failing to compile.

- **`ApiError`** carries an HTTP status, a machine-readable `ApiErrorCode` and optional details.
  Anything thrown that is _not_ an `ApiError` is treated as a bug.
- **`mapError`** (`core/http/error-mapper.ts`) is a pure function translating a thrown value into
  `{ statusCode, body, isOperational }`. It handles `ApiError`, `ZodError`, Mongoose validation and
  cast errors, duplicate-key errors, malformed JSON, and falls back to a generic 500 that never
  leaks an internal message. Being pure, it is unit tested without HTTP.
- **`errorHandler`** is the only place that writes an error response. Operational failures log one
  warning line; unexpected ones log at error level with the stack, and the stack is added to the
  response only outside production.

Status codes are used as intended: `422` for schema-valid-but-rejected input, `400` for malformed
input, `404` for unknown routes and missing resources, `409` for conflicts, `429` for rate limits,
`503` when a required dependency is unusable.

## 4. Request context and logging

`requestContext` runs first: it takes the inbound `x-request-id` (length-bounded, since it is
untrusted) or generates a UUID, records a start timestamp, and attaches a Pino child logger bound
to that id. The id is echoed in the response header _and_ in `meta.requestId`, so a screenshot from
a user leads directly to the server-side log lines for that request.

Pino is configured with a redaction list (`authorization`, `cookie`, `password`, `*.token`,
`*.apiKey`, …) so a stray object dump cannot leak a credential. Pretty output is development-only;
production emits JSON lines.

## 5. Validation

Zod is the single validation library, on both sides of the wire. `validate(schemas)` parses `body`,
`query` and `params` and writes the result to `req.validated` — the raw values are left untouched
because in Express 5 `req.query` is a getter and cannot be reassigned.

Typed access is provided by `validated(schemas, handler)`, which binds schemas to a handler so the
handler receives a fully typed `req.validated`. That helper contains the single type assertion in
the request pipeline; feature modules contain none.

Query-string values arrive as strings, so shared schemas use `z.coerce`. `paginationQuerySchema`
caps `pageSize` at `MAX_PAGE_SIZE`, which — together with `resolvePagination` in the repository —
means no client can request an unbounded read.

## 6. Configuration

`config/env.ts` declares every variable in one Zod schema with defaults, parses `process.env` once
at startup, and throws with a per-variable message if anything is wrong. Production adds
requirements that are only inconvenient locally: JWT secrets of at least 32 characters and at least
one CORS origin. Empty strings are normalised to "not provided", so a placeholder copied from
`.env.example` is not mistaken for a configured value.

`config/index.ts` turns the flat env into a structured, typed object (`app`, `http`, `log`,
`database`, `auth`, `integrations`). Integrations expose a `configured` flag that is true only when
every credential they need is present — the pattern later phases use to decide whether to register
a module. Credentials for Billz, OpenAI, Anthropic and Telegram are _read_ here; none of those
integrations are implemented.

Env files are layered (`apps/api/.env.<NODE_ENV>.local` → … → repo-root `.env`) and never override
the real process environment, so containers, CI and systemd always win over a file on disk.

## 7. Lifecycle

`main.ts` connects to MongoDB (retrying with exponential backoff, since a database container can be
slower to start than the API) and only then binds the port: the process refuses to serve traffic it
cannot fulfil. `createApp()` builds the Express application without touching the network, which is
what the test suite drives.

`createShutdownManager` runs cleanup tasks in reverse registration order — HTTP server first so no
new requests arrive, database last — exactly once, with a hard timeout that force-exits if a task
hangs. `SIGTERM`/`SIGINT` shut down with code 0; an uncaught exception or unhandled rejection shuts
down with code 1 rather than leaving the process in an unknown state.

Health is split three ways because orchestrators need different answers:
`/api/health` (full payload, `503` when a required dependency is down), `/api/health/live`
(process is alive, never touches a dependency), `/api/health/ready` (safe to route traffic here).
Dependency probes are active — an `admin.ping()` rather than a cached connection flag.

## 8. Web client

Layers mirror the API: `services` (HTTP), `stores` (state), `composables` (reusable reactive
logic), `pages`/`layouts`/`components` (presentation).

The Axios layer unwraps the envelope so callers work with the payload directly, and normalises
every transport or API failure into a single `ApiClientError` carrying `code`, `status`, `details`
and `requestId`. Views never inspect an Axios error. The access token is read from `token-storage`
rather than the auth store, so the HTTP layer and the store do not import each other.

Tailwind v4 is configured through `@theme` tokens in `assets/styles/main.css`; colours are defined
once and referenced as utilities, never hard-coded per component.

The router guard (`requiresAuth` / `guestOnly`) is fully implemented but gated behind
`VITE_AUTH_ENFORCED`, which stays `false` until the auth API exists — enabling it now would lock
the shell behind an endpoint that returns 404. Sidebar entries for unbuilt modules render as
disabled rather than being hidden, so the intended shape of the product stays visible.

## 9. TypeScript and code quality

`tsconfig.base.json` is strict, with `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`,
`verbatimModuleSyntax` and `isolatedModules`. `@typescript-eslint/no-explicit-any` is an error;
the codebase contains no `any`. `no-console` is an error everywhere except the bootstrap paths that
may need to report a configuration failure before a logger exists.

The API compiles with `declaration: false`: it is an application, not a published library, and
Mongoose's inferred schema types are too large for TypeScript to serialise into `.d.ts`.

Tests are Vitest and exercise real behaviour, not mocks: pure functions directly, and HTTP paths
through the real Express app with Supertest. `app.test.ts` asserts the envelope and that the health
status maps to the correct HTTP code, so it passes whether or not a database is reachable.

## 10. Known gaps entering the next phase

- No authentication, authorization or user model — every business endpoint depends on this.
- No concrete Mongoose model exists yet, so `BaseRepository` and `createSchema` are compile-checked
  but not exercised against a live collection.
- Rate limiting is in-process (per instance); a shared store is needed before running more than one
  replica.
- The web client has no test suite yet.
