# The agent

Hadiya's assistant is one endpoint — `POST /api/v1/ai/chat` — and behind it one
loop. This document is about what that loop does when a single sentence turns
out to be five steps.

> "Bugungi savdoni analiz qil, eng yaxshi mahsulotlardan 3 ta Instagram post
> tayyorla, rasmlarini yarat va Notiondagi marketing database'iga saqla."

That is a read, an analysis, three writes, three generations and a save to
somebody else's service. It is one message from a shopkeeper and it must behave
like one: one answer, and an honest one.

## What is where

```
apps/api/src/modules/ai/agent/
  agent.service.ts          the loop: rounds, budgets, persistence, final state
  tool-scheduler.ts         one round: waves, dependencies, timeouts, retries
  tool-retry.ts             which failures are worth trying again
  confirmation-gate.ts      whether a claimed agreement actually happened
  pending-action.model.ts   what was proposed, stored, with a clock on it
  pending-action.service.ts recording, matching and withdrawing proposals
  agent-events.ts           the run's narration, and what may appear in it
  agent-cancellation.ts     stopping a run that is already going
```

Nothing above `tool-scheduler.ts` knows what a tool _is_. Nothing below it knows
there is a loop. The registry (`ai/tools/tool-registry.ts`) is the seam, and it
is the same registry Phase 10 left behind — a Billz capability, a Notion read
and somebody's own MCP server are all reached through it, and the agent has no
branch for any of them.

## The loop

```
user message
   │  persisted first, so a provider outage loses the reply and never the question
   ▼
context ──────────── bounded window of history + relevant memories (Phase 5)
   │                 + a note naming anything this conversation is waiting on
   ▼
model  ◄──────────────────────────────────────────────┐
   │                                                  │
   ├─ no tool calls ──► final answer ─► COMPLETED     │
   │                                                  │
   ▼                                                  │
round of tool calls                                   │
   │  confirmation gate → waves → timeouts → retries  │
   ▼                                                  │
results, persisted as their own turns ────────────────┘
```

Each round is persisted as it happens: the assistant's request with its tool
calls, then one `tool` message per result. A replayed thread is exactly what the
model saw.

### Budgets

Every ceiling is configuration (`AGENT_*`), overridable per call, and defaulted
in `AGENT_LIMITS` in the shared package.

| Limit              | Default | What it stops                               |
| ------------------ | ------- | ------------------------------------------- |
| `maxToolRounds`    | 6       | A model that keeps asking for tools         |
| `maxModelCalls`    | 8       | The cost of a run, in completions           |
| `maxParallelTools` | 4       | A round fanning out further than it should  |
| `toolTimeoutMs`    | 45 000  | One slow server stalling a turn             |
| `maxToolRetries`   | 2       | A retry loop against a service that is down |
| `tokenBudget`      | 120 000 | A prompt that grows round on round          |

One completion is always held back. When a budget runs out, the model is called
once more **with no tools at all**, which forces a written answer rather than
another request Hadiya would only have to refuse. `agent.limitReached` in the
reply says that is what happened.

## One round

The model hands back a flat list of calls and no ordering beyond the order it
wrote them in. `tool-scheduler.ts` turns that into execution.

### Waves

A greedy pass in the model's own order. A call joins the current wave when it is
**parallel-safe**, has no in-round dependency on something earlier, and does not
name a resource another call in the wave already holds. Everything else takes a
wave of its own.

```
read_sales    ─┐
read_expenses ─┼─ wave 1 (concurrent)
read_debts    ─┘
create_plan    ── wave 2 (alone: it writes)
```

Parallel-safety is derived, not declared: a read is parallel-safe, a write is
not, and anything waiting on a person's agreement never runs beside anything.
A tool may override it. `resource` is a coarse lock — two MCP calls to the same
server share its rate limit, so they are serialised against each other and
against nothing else.

Results come back in the order they were asked for, whatever order they ran in.

### Dependencies

A tool may declare `dependsOn: ['other_tool']`. If `other_tool` was requested in
the **same round** and did not succeed, this call is skipped and says so.

Nothing is invented to stand in for the missing result. That is the whole rule:
an invented input is worse than a missing step, because the model cannot see
that it was invented. Across rounds `dependsOn` does nothing — by then the model
has the real result in front of it, which is the ordinary way a dependent step
happens.

### Timeouts

Every call has a deadline. It is enforced by not waiting any longer, not by
killing anything: a tool that ignores its `AbortSignal` goes on running in the
background with its result discarded. That is the honest limit here, and it is
exactly why a **write that timed out is never retried** — "it arrived and the
answer got lost" and "it never arrived" look identical from this side.

### Retries

Two gates, in this order:

1. **What kind of tool is it?** Destructive: never. A write that is not
   idempotent: never. Everything else: maybe.
2. **What kind of failure was it?** `timeout`, `network`, `rate_limited` and
   `unavailable` are moments and are retried. `invalid`, `not_allowed`,
   `authentication` and anything unrecognised are answers, and are not.

Bounded by `maxToolRetries`, with exponential backoff and jitter.

### Idempotency

Every call is given an `idempotencyKey` on its `ToolContext` — stable across
retries of the same call, different for every other — so a tool whose upstream
accepts one can forward it.

Where the upstream has no such notion, the guarantee is made here: a write that
is not idempotent is recorded in the run's ledger, and a second request for the
same tool with the same arguments in the same run is answered from the first
result rather than run again. One invoice cannot become two.

## Confirmation

Hadiya has **one** confirmation mechanism, and Phase 11 did not add a second. A
tool declaring `requiresConfirmation` must accept a `confirm` boolean; the
registry refuses to run it until that is `true`.

What Phase 11 added is the server-side half.

```
model calls create_invoice, no confirm
   ▼
registry refuses          ── the tool is not reached
   ▼
Hadiya writes down a PendingAction:
   validated arguments · a description · an expiry
   ▼
model asks the person, in their language
   ▼ (next turn, minutes later, possibly another process)
"Ha"
   ▼
model calls create_invoice with confirm: true
   ▼
confirmation gate: does this match what Hadiya proposed?
   ├─ expired   ─► refused, ask again
   ├─ changed   ─► refused, ask again
   ├─ missing   ─► policy (AGENT_REQUIRE_PENDING_CONFIRMATION)
   └─ matches   ─► the proposal is spent, the tool runs
```

Three properties do the work:

- **The arguments are Hadiya's, not the model's.** They are stored after the
  tool's own schema has validated them, so what is confirmed is what was
  described. The gate re-validates the incoming call the same way before
  comparing, so a schema default cannot make an honest confirmation look changed.
- **It expires.** `AGENT_CONFIRMATION_TTL_MS`, ten minutes by default. Expiry is
  checked in code against the stored timestamp; the Mongo TTL index is
  housekeeping and is not the control.
- **It holds no secret.** Arguments pass through a redaction that drops anything
  named like a credential, and `confirm` itself is never stored.

`AGENT_REQUIRE_PENDING_CONFIRMATION` decides the ambiguous case. Off (the
default), a confirmed call with no proposal behind it is allowed — a model that
proposes and confirms in one turn produces that legitimately — and logged as
unverified. On, nothing runs that this server did not itself ask about.

The client is never trusted. A browser cannot mark an action confirmed; it can
only send a message, which the model reads, after which this check still runs.

## Cancellation

`POST /api/v1/ai/chat/cancel` with a conversation id. The conversation is
fetched against the actor first, so naming somebody else's cancels nothing.

Cancelling aborts the run's `AbortSignal`, withdraws every pending proposal in
that conversation, and appends an honest closing turn. No further tool starts.
A request already in flight may still land — nothing can un-send it — and the
run says `cancelled` rather than claiming it stopped in time.

## State and events

`AgentRunSummary` rides along on the chat response as an optional `agent` block.
Every existing field of `ChatResponse` still means what it did.

```
idle → planning → executing → recovering ──┐
                     │                     │
                     └─ waiting_for_confirmation
                                           ▼
                         completed | failed | cancelled
```

The final state is read from what is actually outstanding rather than from
whatever the last round set: a turn that proposed something and is still waiting
says so, and one whose proposal was answered says `completed`.

Events (`agent.started`, `tool.started`, `tool.completed`, `tool.failed`,
`tool.retrying`, `tool.skipped`, `confirmation.required`, `agent.completed`,
`agent.cancelled`, …) carry **names, statuses, counts and durations, and nothing
else**. No arguments, no results, no credentials — a sanitiser in
`agent-events.ts` enforces it rather than trusting call sites, because these are
designed to be streamed to a browser. `onAgentEvent` is the seam a streaming
transport plugs into later.

## Not claiming what did not happen

The most damaging thing a multi-step agent can do is report a step it did not
complete. So the model does not write its summary from memory: once anything has
run, every subsequent prompt carries a ledger Hadiya generated from what the
tools actually returned, marking each step succeeded, FAILED, timed out, skipped
or waiting.

```
- billz_get_sales_summary: succeeded
- create_content_plan: succeeded
- notion_save: FAILED (Notion is unreachable)
Write the final answer from this record. […] Never say something succeeded when
this record says it did not.
```

The structured `agent.steps` in the reply is the same account, for a client that
would rather not read prose.

## Tool metadata

A tool declares what it does; everything else is derived in `resolveToolPlan`.

| Field                  | Default                                        | Used for                                           |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `mutates`              | —                                              | risk, idempotency, parallelism                     |
| `requiresConfirmation` | `false`                                        | the confirmation gate                              |
| `risk`                 | destructive / write / read, from the two above | policy and the UI                                  |
| `category`             | `other`                                        | grouping, and helping the model narrow a long list |
| `parallelSafe`         | reads yes, writes no                           | waves                                              |
| `idempotent`           | `!mutates`                                     | whether a failure may be retried                   |
| `resource`             | the category, for writes                       | mutual exclusion within a wave                     |
| `dependsOn`            | `[]`                                           | in-round gating                                    |
| `provenance`           | native                                         | attribution that survives the turn                 |
| `timeoutMs`            | the run's limit                                | something known to be slow                         |

The model is told the risk and the confirmation policy — appended to each
description, because no provider has a field for it and a model that cannot see
which of two similar tools writes will eventually pick the wrong one. It is not
told resource names, integration ids or retry policy: none of that helps it
choose, and all of it is surface an injected reply could aim at.

## Security

Everything the earlier phases enforce still applies, and the loop adds nothing
that can bypass it.

- **The actor comes from the authenticated request**, never from the model, and
  is passed to every call. A tool cannot be talked into acting as somebody else.
- **The registry is built per turn, per actor.** One account's MCP servers are
  never in another's registry, and `/ai/status` lists the built-in tools only.
- **Integration ownership and tool permissions are re-read at call time**, in
  `mcp-execution.service.ts`. A registry assembled at the start of a turn can be
  out of date by the end of it.
- **External output is data.** Results reach the model inside a labelled block
  from a named untrusted source, already stripped of control and zero-width
  characters, and always as a `tool` message — never as an instruction and never
  as a turn the person took.
- **No secret travels through a model-written argument.** Tools fetch
  credentials from the credential store against the actor. Events and pending
  actions redact anything named like one.
- **A tool result is bounded** before it is stored or shown, so one enormous
  answer cannot take down the turn it belongs to.

## Configuration

| Variable                             | Default  | Notes                                   |
| ------------------------------------ | -------- | --------------------------------------- |
| `AGENT_MAX_TOOL_ROUNDS`              | `6`      |                                         |
| `AGENT_MAX_MODEL_CALLS`              | `8`      | One is always held back for the answer  |
| `AGENT_MAX_PARALLEL_TOOLS`           | `4`      |                                         |
| `AGENT_TOOL_TIMEOUT_MS`              | `45000`  | Per call                                |
| `AGENT_MAX_TOOL_RETRIES`             | `2`      | Never applied to a non-idempotent write |
| `AGENT_RETRY_BACKOFF_MS`             | `250`    | Doubles per attempt, with jitter        |
| `AGENT_TOKEN_BUDGET`                 | `120000` | Prompt + completion, per run            |
| `AGENT_CONFIRMATION_TTL_MS`          | `600000` | How long an agreement stands            |
| `AGENT_REQUIRE_PENDING_CONFIRMATION` | `false`  | Strict server-side confirmation         |

## Watching a run happen

Everything above describes what the agent does. This describes how a browser
sees it while it is doing it.

### One endpoint, two shapes

```
POST /api/v1/ai/chat                    → JSON, exactly as before
POST /api/v1/ai/chat?stream=1           → the same turn, as it happens
POST /api/v1/ai/chat  (Accept: text/event-stream)   → the same
```

Same handler, same `sendMessage`, same run. A second endpoint would have meant a
second execution path, and two paths through an agent is how the streamed one
quietly stops matching the one that is tested. A client that asks for nothing
gets the JSON reply it has always got, and the `result` frame at the end of a
stream is that same `ChatResponse` object — a streaming client and a waiting one
end up holding the same turn.

Two more endpoints exist for the cases a single connection cannot cover:

```
GET /api/v1/ai/runs/:runId/stream       rejoin, honouring Last-Event-ID
GET /api/v1/ai/runs/:runId              a snapshot, for a browser that reloaded
GET /api/v1/ai/chat/:conversationId/run the newest run in a conversation
```

### Why not `EventSource`

The obvious choice, and the wrong one twice over: it cannot send a body, so it
could not start a turn, and it cannot set an `Authorization` header, so the
access token would have to travel in the query string — into browser history,
into proxy logs, into referrers. The client is `fetch` with a readable body,
which does both properly and gives up only the automatic reconnection, which
`agent-stream.ts` writes out by hand.

### The wire

SSE frames, with the agent event's own type as the event name and its sequence
as the id:

```
id: 4
event: tool.completed
data: {"frame":"event","event":{"type":"tool.completed","sequence":4,…}}
```

Four frame kinds: `ready` (the run has an id), `event`, `result` (the finished
`ChatResponse`), `error`. One `data:` line per frame — `JSON.stringify` escapes
newlines, so a payload can never split itself across two events.

Three headers earn their place. `Cache-Control: no-transform` is what stops this
application's own `compression()` middleware buffering a trickle of small events
until it has enough to gzip — without it the stream arrives in one lump at the
end, which is the exact opposite of the feature. `X-Accel-Buffering: no` is
nginx's opt-out. A comment line every twenty seconds keeps an idle socket from
being reaped.

### The race, and the buffer

A browser cannot subscribe to a run before the run exists. Handled by choosing
the run id in the controller and registering the listener _before_ the agent is
started — so `agent.started` cannot be emitted into a run nothing is watching.

`agent-run-registry.ts` buffers every run's events besides that, which is what a
reconnection reads from. The catch-up and the subscription happen in one
synchronous step; anything else leaves a window where an event is emitted after
the buffer was read and before the subscriber was attached, and that event is
lost silently, exactly when the run is busiest.

State is per process and in memory, which is the honest scope: these are this
process's in-flight runs. Losing them on a restart costs a live view, never a
record — the transcript holds every tool call and its result.

### Reconnecting without repeating

Every event carries a sequence, which is the SSE id. A client that drops rejoins
with `Last-Event-ID` and the server replays only what came after; the reducer
drops anything at or below the highest sequence it has already applied. Between
them, rejoining twice cannot draw a completed step a second time — and two tabs
watching one run agree, because both are folding the same numbered stream.

### Safe display text

An event carries names, statuses, counts and durations. It does not carry
arguments, results, prompts, model messages, upstream bodies or stack traces —
`agent-events.ts` sanitises the payload rather than trusting call sites, because
these are designed to be pushed to a browser.

What makes that usable is that the _label_ is decided server-side, in
`tools/tool-display.ts`, and travels with the event:

```
tool.started   displayName "Sales figures"   runningLabel "Reading the sales figures"
tool.completed                               doneLabel    "Read the sales figures"
```

That is not a nicety. The events name tools the frontend has never heard of —
every tool on somebody's own MCP server — and a bundle shipped last week cannot
have a phrase ready for a server connected this morning. An MCP tool is named by
its own external name and its integration ("My CRM: Search customers"), never by
Hadiya's namespaced registry id.

### Assistant text

`assistant.delta` carries the answer as the model writes it, and only when the
provider can actually send it that way. The OpenAI provider implements `stream`;
Anthropic's does not yet and reports `supportsStreaming: false`, so its turns
arrive whole. Nothing is chopped up to look as though it were streamed.

Deltas are asked for only when somebody is watching (`streamDeltas`), because
token deltas exist to be rendered: asking for them when nothing is subscribed
buys a second transport path in exchange for text that is assembled and thrown
away.

In the browser the deltas accumulate on every event and are _painted_ once per
animation frame. Tokens arrive faster than a screen refreshes, and binding
directly to the accumulation schedules a render per token.

### What the interface promises

- **Nothing is invented.** Every row of the timeline came from an event the
  server emitted. No optimistic step, no predicted next step, no percentage.
- **Parallel work looks parallel.** A step that starts while another is still
  running shares its wave, and the two are bracketed together. Sequential work
  is not drawn as concurrent, and concurrent work is not drawn as a queue.
- **A failed step is never given the past tense of the thing it did not do.**
  "Saved to Notion" under a cross would be the interface contradicting itself.
  A failed row is named by what it was, with the reason beneath it.
- **Confirmation is not authorisation.** The card sends an ordinary message; the
  server's confirmation gate still decides. When the offer lapses the buttons
  go, because pressing them would send a "yes" the server is required to refuse.
- **Stop means stop.** The composer's send button becomes Stop while there is a
  run to stop, and asks once. The server aborts the run and withdraws its
  proposals; the run's own `agent.cancelled` event is what turns the interface
  off.

### Falling back, narrowly

If the stream never opens — a proxy that will not pass `text/event-stream`, a
browser without a readable body — the store sends the turn again as an ordinary
`POST`. That is safe in exactly that case and no other: nothing reached the
agent, so nothing can be duplicated. A stream that dropped _after_ frames
arrived is never re-sent; that turn is running, and asking for it twice would be
two content plans and two invoices.

## Tests

No test spends money or opens a socket. The model is scripted and the tools are
probes whose timing and failures a test dictates — which is the only way
"these two ran at the same time", "the write was not retried" and "the run
stopped when it was cancelled" can be asserted at all.

| File                             | Covers                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/orchestration.test.ts`    | The loop, waves, dependencies, confirmation and resume, expiry, timeouts, retries, idempotency, cancellation, budgets, events, injection, isolation, MCP, two complete workflows, performance |
| `agent/agent-policy.test.ts`     | Failure classification, the retry rules, tool classification, redaction and hashing, event sanitising                                                                                         |
| `agent/agent-provider.test.ts`   | The same loop through the real OpenAI provider, over a scripted HTTP layer                                                                                                                    |
| `integrations/mcp-agent.test.ts` | The assistant with a connected MCP server                                                                                                                                                     |
