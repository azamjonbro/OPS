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

## 10. Business data layer (phase 2)

Eleven domains ship as self-contained modules — branches, employees, categories, products,
customers, inventory, sales, payments and expenses — each with its own model, validators, service,
controller and routes. There is no shared CRUD façade: `BaseRepository` covers plain reads and
writes, and every rule that matters lives in the module's service, where it can be read next to
the data it protects.

**Money** is an integer count of minor units (tiyin) everywhere — schema, service and wire. No
price, cost or total is ever a floating-point number.

**Authentication** is HS256 JWT (access + refresh) signed with `jose`. Passwords are hashed with
scrypt from Node's own crypto module, in a self-describing format so the cost parameters can be
raised later without invalidating stored hashes. The guard is mounted over the whole `/v1` tree, so
a module added to the registry is protected by default rather than by remembering to guard it.
The account is re-read on every request: a suspension or a role change takes effect immediately
instead of when the token happens to expire.

**Authorization** has two parts. Role rank (`hasAtLeastRole`) gates what an action needs, and
branch scope decides which records an actor can see or touch. `admin` and above are
organisation-wide; everyone else is pinned to the branch on their account. Both checks live in
services (`core/security/actor.ts` holds the primitives), so an endpoint cannot be published
without them by forgetting a middleware.

**Stock is never edited directly.** `inventory.service.recordMovement` is the only writer of an
`InventoryItem`, and it always writes the matching `InventoryMovement` in the same breath. The
level moves with a conditional `$inc` — the filter demands enough stock before the decrement — so
two tills selling the last unit cannot both succeed, with or without a transaction. Movements are
append-only: a mistake is corrected by recording an `adjustment`, never by editing history. A
`sale` movement can only be written by the sale flow; a person can record `purchase`, `return` or
`adjustment`, which keeps the stock card consistent with the sales ledger.

**A sale** prices itself. The till sends product ids, quantities and explicit discounts; the
service reads names and prices from the catalogue, so a tampered client cannot decide what
something costs. Lines are embedded in the receipt rather than stored separately — a sale is read,
printed and cancelled as one unit — and each carries a snapshot of the name, SKU and prices
charged, so a receipt still reads correctly after the product is renamed or repriced. `product`
still links to the live record; nothing else is duplicated. The receipt, the stock it consumes,
the payments taken and any debt it leaves are written in one transaction: a sale cannot exist
without having moved the stock, and stock cannot move without a receipt to show for it.
Cancelling reverses all of it — goods return as `return` movements, payments are voided, debt is
cleared — and keeps the receipt, marked cancelled.

**Customer debt** is one number maintained by the sale and payment services only, always inside the
transaction that caused it, and always with `$inc` so concurrent tills cannot overwrite each
other. A receipt's contribution to the balance is exactly its `dueAmount`, which is what
cancelling reverses.

**Transactions** need a replica set. `core/db/transaction.ts` probes support once after connecting
— by running a read _inside_ a transaction, because a standalone server accepts
`startTransaction()` and only rejects the first command that carries it — and falls back to
non-atomic writes with a warning where they are unavailable.

**Indexes** are declared where reads actually happen: `sku` and `barcode` on products (barcode as a
_partial_ index, since a sparse one still indexes the explicit `null` a product without a barcode
stores, which would allow only one such product in the catalogue), `phone` on customers, `username`
on users, `(product, branch)` on stock, and branch + date pairs on movements, sales, payments and
expenses. Nothing is indexed speculatively.

**Tests** run against a real MongoDB, never a mock: unique indexes, conditional stock updates and
transaction rollback only exist in the database. Point `MONGO_TEST_URI` at a replica set to
exercise the atomic paths; a standalone runs the same suite through the fallback.

## 11. Billz integration (phase 3)

One module owns every conversation with Billz, and it is layered so each part has a single job:

```
Hadiya (routes, sync, later the AI)
  -> modules/billz/billz.service.ts     authorization, Billz errors -> API errors
  -> modules/billz/services/*           resources, normalised, shop-scoped
  -> modules/billz/client/*             auth, retry, timeouts, pagination, error normalisation
  -> Billz API
```

Nothing above the service layer knows Billz speaks HTTP, and nothing below it knows about roles or
Hadiya's response envelope. `client/billz-endpoints.ts` is the only file holding a Billz path.

**Evidence, not invention.** Billz has no public API reference, so every endpoint used is confirmed
by the production client recovered from this repository's own history and/or a published Billz v2
wrapper — recorded, with the gaps, in `docs/billz-api.md`. Nothing was implemented on a guess.

**The client** authenticates with the account's secret token, caches the bearer until just before
it expires, and re-authenticates exactly once on a `401`. It retries only what is worth retrying
(`408`, `425`, `429`, `5xx`, network, timeout), honours `Retry-After` when Billz sends one, and
backs off exponentially otherwise. Every failure becomes a `BillzError` with a kind
(`rate_limited`, `timeout`, `malformed_response`, …), and that kind decides the HTTP answer: an
upstream permission problem is _our_ dependency failing, so it surfaces as `503`, never as a `401`
to the person who asked. Logs record the endpoint, status and duration — never the query string,
which can carry a customer's phone number, and never the body, which carries the secret.

**Normalisation** happens once, in `billz.mapper.ts`. Money arrives from Billz in so'm and is
stored as integer minor units like everywhere else in Hadiya; a field Billz omits becomes `null`
rather than an invented zero. Billz's per-shop price and stock arrays are collapsed against
`BILLZ_SHOP_IDS`, so a multi-shop account cannot leak another branch's figures into a report.

**Synchronisation** imports branches, categories, products and customers, in that order, because a
product needs its category and resolves it through the mapping table. Three properties define it.
A Billz id is _never_ treated as a Mongo `_id`: `IntegrationMapping` holds the link, with unique
indexes in both directions so the relationship stays one-to-one and a re-run cannot duplicate.
A content hash means an unchanged record is not rewritten. And the cursor — `last_updated_date`,
the only real incremental window Billz offers — advances only after a clean run, so a failure
repeats its window instead of skipping it. Every run writes a `SyncLog` with counts and any error;
a record that cannot be filed (a product whose category is missing, a customer with no phone) is
counted as skipped and stepped over rather than ending the run.

**Prepared for the AI phase.** `billz.capabilities.ts` is the surface Phase 4 will hand a model:
sixteen named read-only functions, each with a Zod schema for its arguments and a description
written for a model rather than a developer. It is deliberately narrower than the service layer —
Billz's order and client _write_ endpoints are not represented at all, so no prompt can reach them
— and every list capability caps its own size so one question cannot pull the whole catalogue into
a context window.

**Tests** never call Billz. The client takes an injected `fetch`, so authentication, pagination,
timeouts, rate limiting, malformed payloads and every error mapping are exercised against scripted
responses; the sync tests use stubbed services against the real test database, so the mapping,
idempotency and cursor behaviour are checked where they actually live. The test environment pins
fake Billz credentials, so a developer's real token in `.env` can never reach a test run.

## 12. Conversations and memory (phase 5)

Three collections, deliberately separate. A `Conversation` is the thread and its counters; a
`Message` is one turn; a `Memory` is one durable fact. Messages are not embedded in the
conversation because a thread grows without bound and every list read would drag the whole
transcript with it.

**Privacy is the query, not a check.** Every conversation and memory read filters on the actor's
id, so a query cannot match another user's row — safer than fetching a document and then deciding
whether the caller should have seen it. A stranger asking for a thread by id gets `404`, not `403`,
because a `403` would confirm the id exists.

**Memory identity** is `(user, type, key)`, with a partial unique index over the live statuses.
Re-learning a preference updates it instead of leaving two answers to one question, and forgetting
sets `status: 'deleted'` with a timestamp — the row survives, the key is freed, and a dropped
memory cannot quietly return.

**Nothing sensitive is remembered.** `memory-privacy.ts` classifies a candidate before it is
stored and refuses outright rather than redacting: a remembered secret outlives the conversation
and is replayed into later prompts. Matching folds `_` and `-` to spaces, because the keys that
matter look like `wifi_password` and `company_iban`, where a `\b` anchor never fires.

**Confidence decides trust.** What a person states is active immediately. What the assistant infers
below the confidence threshold is stored as `pending`, kept out of every prompt, and surfaced in
the chat response so the client can ask — the confirmation path, rather than a silent guess.

**Context is bounded by construction.** `context-builder.service.ts` takes a window of recent
messages and a short list of relevant memories, then trims from the oldest end to a character
budget, dropping a tool result together with the turn that asked for it so the model never sees an
answer to a question it cannot see. The system prompt is outside the trimmable window.

**Retrieval is a seam.** `MemoryRetriever` is an interface; today's implementation scores keyword
overlap, memory type and recency, and needs no extra infrastructure. Preferences and standing
instructions keep a floor score so "always answer briefly" survives a question it shares no words
with. A vector-backed retriever implements the same interface and replaces it without the context
builder or the agent noticing — which is why no embedding column exists yet.

**The tool registry is the only dispatch.** A name that is not registered is refused, and arguments
are validated against the tool's own Zod schema before anything runs, so a hallucinated call cannot
reach the database. The actor comes from the authenticated request, never from the model.

**The model is behind an interface.** `AiProvider` is what the agent is written against, so the
whole turn — persistence, context, tool rounds — is exercised in tests with a scripted provider and
no paid API call. Until a real client is registered the endpoint answers `503`; a canned reply
would look like a working assistant and poison history with text no model produced.

## 13. Reminders, scheduling and notifications (phase 6)

Four pieces, in a straight line: a tool asks the reminder service for something, the service writes
a `Reminder` and a `ScheduledJob`, a worker runs the job when it comes due, and a notification
provider delivers it. Nothing in the AI layer knows how scheduling works, and nothing in the
scheduler knows what a reminder is — `reminder.jobs.ts` is the only seam between them, and it is
registered at start-up rather than imported by either side.

**Jobs are rows, not timers.** A `setTimeout` lives in one process's memory: it is lost on deploy,
on a crash, and on the second instance never having had it. `ScheduledJob` is a document with a due
time, so a restart loses nothing and the claim query asks for everything due _at or before_ now —
which is also how an outage is caught up on rather than silently skipped.

**Claiming is one atomic write.** `findOneAndUpdate` flips `pending` to `running`, takes a lease and
increments `attempts` in a single operation; two workers racing produce one winner and one `null`,
with no read-then-write window between them. A job still `running` after the lease expires is
assumed to belong to a dead process and is claimable again, which is how work in flight survives a
crash. The dead worker's attempt still counts, so a job that kills its worker cannot retry forever.

**One key, one execution.** Every occurrence has an idempotency key — `reminder.deliver:<id>:<ms>` —
under a unique index, and enqueuing only ever inserts: an existing row is returned untouched, even a
long-finished one. The same key is the notification's `dedupeKey`, so the guarantee holds one level
down too: a retry after a partial failure finds its own earlier row instead of writing a second copy
into the inbox.

**Two time fields, both load-bearing.** `scheduledAt` is a UTC instant, the only representation that
cannot be misread; `timezone` is the wall clock the person meant it in, and it cannot be recovered
from the instant. Repeats are rebuilt as "09:00 on the next matching day in Tashkent" rather than as
"add 168 hours", so a weekly reminder holds its local hour across a daylight-saving change instead
of drifting. `utils/timezone.ts` does the conversion with `Intl`, which already carries the full
IANA database, rather than adding a dependency that ships its own copy.

**Recurrence is RFC 5545.** A repeat is stored as an RRULE string — `FREQ=WEEKLY;BYDAY=MO`, the same
text an `.ics` file carries — not a shape invented here. Only the supported subset parses; `FREQ=YEARLY`
or an ordinal `2MO` is refused rather than half-understood, because a rule that parses but is
evaluated wrongly fires on the wrong days forever and nothing about the record looks broken. The
assistant sends structured fields and the rule is built from them, so a model that has never read
the spec cannot produce a subtly wrong one.

**Ambiguity is a question, not a default.** "Bugun kechqurun eslat" resolves only if the user has
told us what evening means to them (a Phase 5 memory, `evening_reminder_time`); otherwise the tool
answers with the question to ask. A bare date behaves the same way — midnight would be a guess, and
the wrong one. The clarification comes back as a successful tool result rather than a failure, so
the model reads it as something to ask rather than something that broke.

**Delivery is behind a provider interface.** The reminder service asks for a message on some
channels; the registry decides what that means. In-app is implemented and always available; Telegram
is registered, reports itself unavailable, and is skipped with a recorded reason. If no channel
accepted the message the service throws, the scheduler retries with exponential backoff, and once
the attempts are spent the reminder is marked `failed` with the reason — a notification that went
nowhere is visible rather than silent.

**Isolation is the query again.** Every request-facing reminder and notification call filters on the
actor's id, so a stranger's id match is impossible rather than merely rejected. The scheduler-facing
functions take no actor because no user is making the request; they are reachable only from a job
the process itself enqueued.

## 14. Content engine (phase 7)

Two collections, and the split between them is the central decision. A `ContentPlan` is the
campaign; a `ContentItem` is one day. Items are not embedded, because a plan is edited one day at a
time — "3-kunni o'zgartir", "captionni qisqartir" — and embedding would turn each of those into a
rewrite of the whole document, re-validated in full, with two people editing different days able to
clobber each other.

**Generation is a second call, not the agent's own words.** The conversational agent runs a tool
loop and produces prose; `generateStructured` runs a single call with no tools and produces an
object of a known shape. Merging them would mean the tool-calling loop also had to be a JSON
validator, and a plan improvised as tool arguments is exactly the thing that would not satisfy a
schema. So a generating tool makes its own structured call inside itself — which is why a scripted
provider answers twice per turn in the tests.

**Nothing unvalidated is stored.** A reply is parsed with narrow recovery — a code fence removed,
prose either side ignored, a trailing comma dropped — then validated against a Zod schema. Recovery
never guesses at content: it fixes packaging and syntax with one possible reading, and stops. A
failure is retried _once_ with the validation errors handed back, which fixes the common case
without turning a failing prompt into unbounded spend, and then becomes a controlled `503`.

**The model counts days, the service works out dates.** Generated items carry a `dayOffset`, not a
date. Models are unreliable at calendars and reliable at ordering, and the indirection also means a
generated plan can be moved later without asking the model anything.

**Editing is by field.** `updateItem` writes only the fields it is given, and `regenerateItem` takes
a `fields` list — so "hashtaglarni yangila" replaces the hashtags and leaves the caption the person
already approved. The model is still shown the whole item, so its rewrite stays coherent; only the
named fields are written back. A rewritten `ready` item drops to `draft`, because the copy is no
longer the version that was approved.

**Business facts are passed in, never fetched.** The content module never queries products or sales.
The assistant decides whether a plan should be based on what is selling, gathers it with
`get_sales_summary` or `get_products`, and passes it as `businessContext`. Otherwise every "write me
a caption" would silently run a catalogue read, and the data in a plan would be data nobody asked
for.

**Preferences come from active memory only.** Language, tone, style, platform, brand voice and
audience are read from Phase 5 memory with `status: 'active'`. A `pending` memory is something the
assistant guessed and nobody confirmed; a `deleted` one was explicitly dropped. Letting either shape
a caption would reintroduce it with nothing on screen to explain why the tone changed. Every field
is nullable and nothing is defaulted — a missing tone means the model is told no tone.

**Confirmation is enforced by the registry.** `requiresConfirmation` on a tool makes `ToolRegistry`
refuse to run it until the validated arguments carry `confirm: true`, returning a
`needs_confirmation` status carrying `describeConfirmation`'s summary. The guard lives in the
registry rather than in each tool so a new destructive tool cannot forget it, and the description is
read from the database _after_ validation, so the person is told what would actually go rather than
what the model believed it had selected. That read is scoped like every other, so proposing to
delete somebody else's plan fails as "not found" and never leaks the title.

## 15. Known gaps entering the next phase

- Refresh tokens are stateless and cannot be revoked before they expire; signing out is a
  client-side discard. A denylist belongs in the auth module before multi-device use matters.
- Rate limiting is in-process (per instance); a shared store is needed before running more than one
  replica, and the login endpoint deserves a stricter limit of its own.
- Reporting reads (daily takings, margin, stock valuation) have no endpoints yet; the data they
  need is all recorded.
- Cancelling a sale reverses stock and payments but does not model a partial refund.
- The web client has no test suite and no screens for any of these endpoints; phase 5 adds the
  conversation store the chat UI will bind to, not the UI.
- No model client is registered, so `/ai/chat` cannot answer in production yet.
- Tool rounds are capped at three per turn; there is no streaming and no cancellation.
- Memory retrieval is keyword and recency scoring over a bounded candidate set, which will need
  replacing once one user holds thousands of memories.
- Billz exposes no expenses, sales reports, warehouses, suppliers or purchase data to an API-key
  credential (`docs/billz-api.md`), so those parts of the domain can only come from Hadiya's own
  records.
- Content is never published anywhere: the engine plans and writes, and `published` is a claim the
  user makes rather than something Hadiya observes. There are no platform integrations.
- Image generation is not implemented, so an item describes what to shoot and carries no asset.
- A generated plan costs one model call per request and there is no caching, so regenerating the
  same brief pays twice.
- Telegram and e-mail are declared notification channels with no working provider: delivery needs a
  chat id or address per employee, so everything arrives in-app for now.
- The scheduler polls every fifteen seconds, which bounds how precisely a reminder fires; a job due
  between ticks waits for the next one.
- Finished jobs are purged by `purgeFinishedJobs`, which nothing calls on a schedule yet.
- A Billz sync is still triggered by hand, although the scheduler that would run it now exists.
- Billz sales are read through, not imported: Hadiya's `Sale` collection stays its own POS's record,
  so the two never fight over one receipt.
