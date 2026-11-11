# Nautilus API

Hono on Cloudflare Workers, Better Auth 1.7, Prisma 7, and Neon Postgres.
Use Bun 1.3.13 and run workspace commands from the repository root. The web app
runs on http://localhost:3000 and the API on http://localhost:8787.

## Access model

- A user has one email/password identity and can belong to multiple organisations.
- `user.platformRole` is server-controlled. Only `admin` users can create an
  organisation. Signup and profile updates cannot set this field.
- The creating platform admin becomes the organisation's initial owner. Invite
  the customer's owner through the same invitation flow as other members.
- Organisation `owner` and `admin` roles can invite members. An organisation role
  does not grant platform administrator privileges.
- Public registration requires a matching, pending, unexpired invitation ID in
  `X-Invitation-Id`. Registration does not create membership. The user must verify
  their email, sign in, and accept the invitation. Existing users sign in and
  accept their invitation without registering again.
- Better Auth checks the invitation recipient, expiry, status and email
  verification. Invitations expire after 48 hours; cancelled/accepted invitations
  cannot be reused. Membership is unique per user/organisation.
- Sign-in automatically selects the organisation when there is one membership.
  With several memberships, the client chooses one using `organization/set-active`.
- Business routes check current membership on every request. Platform admin status
  alone does not bypass tenant isolation. Use the same check and filter by
  `organizationId` when adding business tables and endpoints.

## Environment and migrations

Copy `apps/server/.env.example` to `apps/server/.env`, preserving any existing
values. The runtime uses pooled `DATABASE_URL`; Prisma migrations use direct
`DATABASE_URL_UNPOOLED`. Prisma config explicitly loads this workspace's `.env`.
Wrangler also loads `.env` for local bindings (do not maintain an overriding
`.dev.vars` with different values). Real secrets and generated clients are ignored.

```sh
bun install
bun run --filter @nautilus/server db:generate
bun run --filter @nautilus/server db:deploy
```

The schema includes Better Auth's `user`, `account`, `session`, `verification`,
`organization`, `member`, and `invitation` tables, plus database-backed `rateLimit`
and a local-only `emailMessage` outbox. Both the Worker client (`workerd`) and the
Bun operator/test client are generated from the same schema. Generate before
starting development; the dev script does this automatically after a read-only
`prisma migrate status` check. Pending migrations stop startup before Wrangler
accepts requests. Run `bun run --filter @nautilus/server db:deploy`, then restart
development. Use `bun run --filter @nautilus/server db:status` to inspect migration
state without changing the database. Builds still do not apply migrations.

For future changes, create a migration with `db:migrate --name <name>` against a
Neon development branch, review the migration, test it there, then apply the
committed migration with `db:deploy`. Do not use `db push` against production.

## First platform administrator

There is no public bootstrap endpoint. Run this operator command with a strong
password supplied through the environment (never commit passwords):

```sh
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD='<a unique password of 12–128 characters>' \
bun run --filter @nautilus/server db:bootstrap-admin
```

The operator verifies the administrator's email out of band. Bootstrap creates a
verified admin and hashed credential account atomically. It refuses to overwrite
an existing account, reset a password, or promote an existing user.

For the initial local setup, the administrator is `elgiusespinofficial@gmail.com`.
Its generated password is in `apps/server/.local/admin-credentials.json` (gitignored
and readable only by the filesystem owner). Change it after signing in.

## API contract

All auth endpoints live under `/api/auth`. Better Auth's React client can use
the `organizationClient()` plugin. The frontend proxies `/api/*` to Hono and
uses the same-origin Better Auth client. Browser requests include credentials.
Only `WEB_ORIGIN` is allowed by CORS and trusted origins.

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/health` | Public process health |
| POST | `/api/auth/sign-in/email` | Email/password sign-in; verified email required |
| POST | `/api/auth/organization/create` | Platform admin only; body `{name, slug}` |
| POST | `/api/auth/organization/invite-member` | Organisation owner/admin; `{email, role, organizationId}` |
| POST | `/api/auth/sign-up/email` | `{email, password, name, callbackURL?}` and `X-Invitation-Id` header |
| POST | `/api/auth/organization/accept-invitation` | Verified, signed-in recipient; `{invitationId}` |
| POST | `/api/auth/organization/set-active` | Membership checked; `{organizationId}` |
| GET | `/api/me` | User, memberships, valid active organisation, selection requirement |
| GET | `/api/organizations/:organizationId` | Current member only; 404 for other tenants |
| GET | `/api/admin/organizations` | Platform admin organisation list (up to 100) |
| GET | `/api/admin/email-outbox` | Platform admin only; localhost outbox mode only |
| POST | `/api/auth/request-password-reset` | `{email, redirectTo}`; sends reset email |
| POST | `/api/auth/reset-password` | `{token, newPassword}`; revokes existing sessions |
| POST | `/api/auth/change-password` | `{currentPassword, newPassword, revokeOtherSessions: true}` |
| POST | `/api/auth/sign-out` | Ends the current session |

Passwords require at least 12 characters. Better Auth also provides email
verification, session management, member removal and role management endpoints.
Session cookies are HTTP-only; cookie caching is disabled so access revocation is
checked against current database state. Auth rate limits persist in Postgres.
Responses containing account/session data are marked `Cache-Control: no-store`.

## Email and invitation flow

Local `EMAIL_DELIVERY_MODE=outbox` stores messages in Postgres rather than sending
them. Sign in as the platform admin and fetch `/api/admin/email-outbox` to obtain
verification, invitation, and password-reset links. Do not expose the local
outbox on a public deployment.

Invitation links target `WEB_ORIGIN/accept-invitation?invitationId=...`. The web app
carries the ID into the signup header, preserves it through email verification
and sign-in, then asks the recipient to accept the invitation. Verification emails point at the backend's
verification handler and redirect to the trusted callback supplied at signup.

For production, configure `EMAIL_DELIVERY_MODE=resend`, `RESEND_API_KEY`, and a
verified sender in `EMAIL_FROM`. The API refuses public outbox configuration and
missing delivery credentials. Production email delivery has not been exercised
without a provider key. Use web/API subdomains under the same site, or proxy the
API through the web origin, so browser session cookies work with their default
SameSite policy. Separate unrelated domains need a deliberate cookie strategy.

Set runtime secrets through Wrangler secrets or Cloudflare's dashboard, including
`DATABASE_URL` and `BETTER_AUTH_SECRET`; set the actual HTTPS API URL and web origin.
`DATABASE_URL_UNPOOLED` is an operator/CI migration credential, not a Worker binding.

## Agent LLM communication

The backend uses Vercel AI SDK 7 (`ai`) and its `ToolLoopAgent` abstraction.
`src/agent_interface` creates reusable agents with both `generate()` and `stream()` methods.
`src/ai.ts` retains the model factory and a compatibility export for direct chat.
Their instructions come from the saved agent name, purpose, and ordered rules.
Calls use the AI SDK OpenAI provider (`@ai-sdk/openai`) directly through the Responses API, configured per
request from Cloudflare bindings:

- `OPENAI_API_KEY`: server-only OpenAI API key; add it to the local `.env` when
  ready and use `bunx wrangler secret put OPENAI_API_KEY` from
  `apps/server` for production.
- `LLM_MODEL`: an OpenAI text model ID (`gpt-*` or `o*`) that supports the Responses
  API and Structured Outputs. Set it in the local `.env` and use
  `bunx wrangler secret put LLM_MODEL` from `apps/server` for production. There is
  no hard-coded default; the same model powers chat, agent creation, and avatars.

Requests set `store: false`; Nautilus continues supplying conversation history.
Reasoning effort uses model defaults and can be set programmatically in future;
it is not configured through environment variables. Reasoning summaries are disabled.
Agent creation and avatar previews retain their
validated JSON contracts; avatars generate SVG geometry using the text model.
Avatar 429 responses distinguish temporary throttling from `insufficient_quota`
billing/usage exhaustion and use provider retry headers when present.

`OPENAI_API_KEY` and `LLM_MODEL` are required for AI creation and chat. Missing configuration
returns 503 for those requests while other endpoints continue working.

`POST /api/organizations/:organizationId/agents/:agentId/chat` requires a signed-in
member and the trusted `Origin`, with the same tenant isolation as agent profiles.
Send JSON, for example:

```json
{
  "messages": [{ "role": "user", "content": "Help me plan this research." }],
  "stream": false
}
```

The JSON response contains `{ agentId, text, finishReason, usage }`. Set `stream`
to `true` for an AI SDK UI message SSE response, including sanitized error events.
The request still uses text `messages`, not the SDK UIMessage `parts` format.
Only user and assistant text messages are accepted, with up to 50 messages and
32,000 total characters. The caller supplies history for each request; messages
are not persisted or automatically added to rooms. Client-supplied models,
system instructions, and tools are ignored. Each call has a 60-second timeout,
a 4,096 output-token limit, and at most one retry. Disconnects abort generation.
No tools, file uploads, or background agent execution are enabled by this endpoint.

Room conversations use `POST /api/organizations/:organizationId/rooms/:roomId/messages`
to save the user message first, then `POST /api/organizations/:organizationId/rooms/:roomId/messages/:messageId/reply`
with `{ "agentId": "..." }`. The reply endpoint checks the agent's room assignment
and that the requesting user authored the saved message. It loads up to 50 saved
messages ending at that message, within 32,000 characters, and uses the agent's
current name, role, and rules. Other participants are labeled in the context;
only the selected agent's messages use the assistant role. Replies are saved as
agent-authored room messages and returned as `{ message }` after generation.
The room UI selects a sole assigned agent automatically, offers a selector for
multiple agents, and supports team-only messages. Failed replies can be retried
without reposting the user message. Room chat uses the same AI bindings above;
it does not include document contents or browser-local files in model requests.

## Validation

```sh
bun run lint
bun run typecheck
bun run build
bun run --filter @nautilus/server test
```

Integration tests run only with `TEST_DATABASE_URL` pointing to a dedicated Neon
branch. They execute Hono requests directly, use the actual Neon database and
Better Auth, and do not start servers. They clean up only their own fixture rows.

```sh
TEST_DATABASE_URL='<development branch pooled connection>' \
bun run --filter @nautilus/server test
```

To exercise the same suite through an already-running local Worker instead of
in-process Hono requests, also set `TEST_BASE_URL=http://localhost:8787` and point
`TEST_DATABASE_URL` at the same database used by that Worker. The suite only allows
localhost HTTP targets, creates uniquely named fixtures, and removes those
fixtures afterward. It never starts a server. The initial setup was tested both
on `dev-auth-implementation` and through the running Worker.

`bun run build:server` is a local Wrangler dry run. `bun run deploy:server`
publishes to Cloudflare and is a separate operation. No deployment is performed
by migration, generation, build, or test commands.

### Agent creator

`POST /api/organizations/:organizationId/agent_creator_agent` accepts the user’s
work description and chosen identity:

```json
{
  "name": "Scout",
  "color": "blue",
  "avatarIcon": "circle",
  "description": "Research vendors, compare pricing, and cite reliable sources."
}
```

The route requires a session, live organization membership, and the trusted
`Origin`. Descriptions are trimmed and limited to 6,000 characters. The creator
uses AI SDK `generateText` with `Output.object` to generate validated JSON
`{ purpose, rules }`. The purpose is saved as `agent.role` (up to 70 characters),
and ordered rules are saved as `agent.rules` (up to 6,000 characters combined).
The selected name and avatar remain user-controlled; tenant and status are server-owned.
Both creation and profile updates accept an optional `avatarDesign` containing
`bodyPath`, a hex `color`, and two `eyes` with `cx`, `cy`, `rx`, and `ry`. The shared
validator rejects markup, external references, unsupported path commands, and
out-of-bounds geometry. The validated design is stored in `agent.avatarDesign`
(JSONB) and included in agent lists, room details, and WebSocket agent options.
Send `avatarDesign: null` to return to a preset. A custom design and an uploaded
`avatarUrl` cannot be selected together. Generating a preview alone does not save it.

Validation, structured generation, and persistence are separate functions in
`src/agent-creator.ts`; `src/agent-creator-route.ts` orchestrates them. The response
is HTTP 201 with `{ agent }`, used immediately by the frontend to show the new
agent and open its profile. Invalid input returns 400, duplicate names 409,
missing AI configuration 503, and provider or structured-output failures 502.
No profile is saved if generation fails. Existing profile CRUD routes remain available.

## Room chat

Room chat is shared by human room members. Agent chat remains on the dedicated
agent API; the former room agent-reply and HTTP message/read endpoints are removed.
Historical agent messages remain in the database and are excluded from user chat.

The `ROOM_CHAT` Durable Object binding coordinates one room per organization/room
ID pair. Wrangler includes the `room-chat-v1` SQLite Durable Object migration.
Apply the Prisma migration `20261103090000_room_chat_delivery` before deploying the
new API: it adds the nullable client message ID and its unique delivery constraint.
Use `bun run --filter @nautilus/server db:deploy` against the intended database.

The browser obtains a 30-second, single-use ticket using the normal authenticated
API, then connects directly to the backend WebSocket URL. `ROOM_SOCKET_ORIGIN`
optionally overrides the origin of that URL; otherwise it uses `BETTER_AUTH_URL`.
Set it to the publicly reachable backend HTTP(S) origin if auth uses a different
host. The URL is converted to `ws:`/`wss:` automatically. `WEB_ORIGIN` must match
the browser's origin exactly; WebSocket upgrades check it explicitly. Production
must use HTTPS/WSS. Do not log connection ticket query strings.

Only a current organization and room member with a live session can connect or
exchange events. An existing organization member can explicitly join through the
room's Join room chat action. Access is rechecked for every event and recipient,
and idle connections are checked every 30 seconds. Multiple tabs count as one
online user. Typing expires after four seconds. Read timestamps are persisted;
live read receipts are broadcast to connected members.

All message delivery, history, reconnect replay, typing, presence, and read events
use the WebSocket. The server saves before broadcasting and acknowledging. Clients
retry with the same UUID; the unique room/user/client-message key prevents a second
insert. Writes are serialized per room and timestamps advance monotonically so
resume cursors cannot skip simultaneous posts. History/replay pages contain up to
100 user messages, with room-scoped cursors. User-action events and read receipts
each have a separate limit of 40 per ten seconds per connection. The browser
coalesces read receipts to one per second, including a final receipt after a burst.
Text is limited to 20,000 characters.

The UI keeps pending sends in memory while reconnecting. Refreshing or closing the
tab discards unsent drafts/pending sends. Saved messages survive refreshes.

Validation:

```sh
bun run --filter @nautilus/server test
bun run --filter @nautilus/server test:room-socket
```

The runtime test uses real local workerd WebSockets and Durable Objects with an
in-memory database boundary. It needs localhost listeners and does not touch the
configured database. It covers delivery, acknowledgements, duplicate retries,
205-message reconnect replay, room isolation, origin/ticket/session checks,
revocation, typing, presence, and read receipts.

### Private @ agent instructions

Typing a standalone `@` in the room composer loads agents assigned to that room.
Select an agent with the mouse or Arrow/Enter keys. Text after the mention becomes
that user's private instruction. Text before it stays as an unsent room draft.
The selected agent chip and private conversation show “Only you.” Private mode does
not emit the room typing indicator. An unresolved mention cannot be sent as a
public room message; email addresses continue to work as ordinary text.

Agent profiles are organization resources assigned to rooms. Each user's execution
and conversation history are private, even when two people select the same agent.
The server checks live room membership and the agent's room/organization assignment,
and derives the owner from the authenticated WebSocket. Client-supplied user IDs
are ignored. The model receives only that user's completed conversation turns with
that agent, plus the new instruction and the saved agent profile. Room messages and
other users' instructions are never added to that context.

`agent.list`, `agent.invoke`, and `agent.history` use the room WebSocket. Results
stream as `agent.update` snapshots with monotonic revisions. Instructions and
replies are sent only to the owner's currently authorized connections in this room,
including their other tabs. They never pass through the shared broadcast function
or `RoomMessage`, and are excluded from shared history and reconnect replay.

Private jobs and the room FIFO are stored in the room Durable Object's SQLite-backed
storage. Up to 20 pending requests per user and 100 per room can be accepted. The
latest 50 private turns are retained (pending entries are protected from pruning).
Request IDs deduplicate invocations within that retention window. Acceptance saves
the queue entry and alarm together; queued requests survive coordinator eviction.

One moderator run owns the room at a time. Simple requests use its existing Office
tools directly. `delegateWork` runs up to three assigned specialists concurrently,
with six assignments and twenty bounded proposals per request. Specialists can read
only their assigned document IDs and prepare typed proposals; only the moderator
can apply shared edits. Proposals are checkpointed before application, and obsolete
base versions are rejected. Independent batches run sequentially through the writer.
The moderator has 32 model steps and a 180-second run deadline; specialists retain
their bounded eight-step/60-second runtime.

A token-scoped 240-second database lease makes **all persisted room documents
read-only for humans** during an active run, including planning and specialist work.
Every document save, creation, and metadata update locks/checks the room row in the
same database transaction as the mutation. Agent writes require the owning token;
expired and replaced runs cannot commit. Room settings/agent assignment changes
are also guarded. Explicit file import is rejected while locked; local file picker
and preview behavior is unchanged. Original browser Files are never enrolled in
agent work or uploaded by this queue.

`agent.cancel` cancels only the caller's own queued/running request. Cancellation
preserves any committed batches. If a process dies mid-run, recovery waits until
its lease deadline, reports interruption, and retains confirmed commit references.
It does not automatically replay an active run with possibly committed edits.
Queued work then continues. A user may review the saved state and retry explicitly.
Model/provider errors are sanitized. Private instructions and replies never enter
shared activity or another user's model context.

`GET /api/organizations/:organizationId/rooms/:roomId/work` and shared `work.update`
notifications expose only lock state, queue count, agent names/colors, document
targets, and saved version heads. The UI polls as a reconnect fallback, fails closed
when activity is unavailable, and shows colored cursor icons with target labels.
These markers describe agent targets rather than simulated typing positions.
The editor refreshes clean snapshots after a run; unsaved drafts remain available
for download and require an explicit discard before opening a changed saved version.

Apply `20261104130000_room_agent_work_lock` with the normal database deployment
procedure **before deploying this server version**. The existing `ROOM_CHAT`
Durable Object binding is reused; no new Cloudflare queue binding is required.
AI still uses the existing `OPENAI_API_KEY` and `LLM_MODEL` bindings.

Additional checks:

```sh
bun run --filter @nautilus/web test:room-composer
bun run --filter @nautilus/web test:room-chat
bun run --filter @nautilus/server test:room-socket
```

The composer check runs in an isolated DOM process. Runtime tests verify private
payload isolation across users, same-user tabs, spoofed history owners, duplicate
invocations, unassigned agents, and nonblocking shared chat while an agent streams.
They replace the model provider and database boundary, so they never send private
instructions to a live provider or alter the configured database.

### Room prompt suggestions

`POST /api/organizations/:organizationId/rooms/:roomId/suggestions` requires a live
session and room membership. The server reads the latest five public user messages
from that room, orders them chronologically, and requests three short prompts via
OpenAI Responses with strict structured output and `store: false`. It uses the
existing `OPENAI_API_KEY` and `LLM_MODEL` bindings. No client-supplied history,
private agent exchanges, files, or document content enters the request.

The room Durable Object shares concurrent requests, persists a cache keyed by the
five messages (including text and edits), and permits at most one generation attempt
per 30 seconds. Each input message is capped at 4,000 characters, generation has a
15-second timeout, and errors return an empty suggestion list without provider details.
Cooldown responses include `retryAfterMs`. Empty rooms skip generation entirely.

The browser debounces refreshes after room messages change and retains the static
prompts when generation is unavailable. Clicking a prompt only fills the draft.
Reasoning effort remains a local UI preference and is not included in this endpoint.

Checks: `bun test apps/server/tests/room-suggestions.test.ts` and
`bun --cwd apps/web tests/room-suggestions.ui.tsx` from the repository root.


## Agent interface and skills

Room `@` instructions follow `agent.invoke` → `PrivateRoomAgents` →
`room-moderator` → `agent_interface` → AI SDK `ToolLoopAgent`. The SDK handles all model calls,
validates function arguments and executes skill handlers before returning their
results to the model. Existing private job delivery and text history are retained;
this module adds no memory system or changes to private-response visibility.

`createAgentInterface(profile, model, skills)` composes agent instructions with
skill instructions and tools. A skill has an ID, instructions, and an AI SDK tool
map. Duplicate tool names fail at construction. New skills should provide typed
schemas and execute handlers instead of interpreting arbitrary model text.

Room agents receive document and spreadsheet skills through `createOfficeSkills`.
They can list saved room files (100 per page, with `nextCursor` passed as `after`
and an optional case-insensitive `title` filter), read document bodies, find text, read workbook
metadata and ranges, and apply atomic edit batches as agent-authored versions.
Each batch supports the operations documented in `skills/docs.md` and
`skills/spreadsheets.md`. The private Office service handles snapshot reads via
`POST /read` and edits via `POST /edit`; Univer stays out of the Worker runtime.
Configure the existing Office service and storage bindings before using these tools.

Trusted socket context supplies organization, room, user and agent identity.
Every tool call rechecks membership and agent assignment. Reads and writes remain
room scoped; writes require a version read during the current run and use the
existing optimistic concurrency checks. Tool cancellation propagates to Office requests
and is checked before storage writes and inside the version transaction. Range reads
include only the workbook styles referenced by returned cells. Moderator tool execution is sequential; delegated specialists prepare work in parallel.
The limits and recovery behavior are described above. Storage/database error details are
not returned to the model. Local uploads and unsaved browser changes are not tool
inputs. Only saved Univer documents can be edited. Clean open editors refresh after the
room run ends; local drafts are preserved when the saved document has changed.

Moderator/lease checks: `bun test apps/server/tests/room-moderator.test.ts
apps/server/tests/room-write-lock.test.ts apps/server/tests/private-room-agents.test.ts`.
Room activity UI checks: `bun run --filter @nautilus/web test:room-work`.


### Agent guardrails

Platform safeguards and tool contracts take precedence over custom profiles and user
requests. Profile text is serialized as JSON task configuration; document content,
tool output, and specialist reports are untrusted evidence. Profile creation,
updates, generated instructions, and runtime initialization reject common explicit
attempts to override safeguards, disclose credentials, or misreport success.
This normalized pattern check is defense in depth, not a complete semantic filter;
obfuscated, indirect, or multilingual instructions may evade it.

Every moderator commit, including accepted specialist proposals, requires a separate,
tool-free structured review against the original private user conversation, exact
edit operations, and reads at the expected document version. Custom profile rules
are excluded from the reviewer. Missing evidence, oversized context, rejection,
invalid output, provider errors, timeout, and cancellation block the write. Access
is checked again after review; existing version and room lease checks still apply.
Review evidence is limited to 100,000 characters per document and the full review
input to 160,000 characters. Narrow requests that exceed these limits. Each commit
adds a model call with a 20-second timeout and no retries, increasing cost and latency.
This model review can make mistakes; it does not prove user intent or factual accuracy.

Specialists expose proposal-only edit tools. A successful proposal is never reported
as a saved shared version. Only a successful commit result establishes a saved edit.

### Room attachments (Bunny S3)

Room files selected or dropped in the browser remain local. **Save to room** is
an explicit upload of the original file (non-empty, up to 10 MB). Attachments are
separate from editable document snapshots and do not trigger Office conversion.
The original local `File` remains available until removed or the page is left.

Configure `S3_BUCKET` and `AWS_ACCESS_KEY_ID` with the Bunny storage zone name,
`AWS_SECRET_ACCESS_KEY` with its writable zone password, `S3_REGION` with its
primary region code, and `S3_ENDPOINT` with its S3 endpoint (for example,
`https://sg-s3.storage.bunnycdn.com`). The zone must support S3 compatibility.
Credentials stay on the API; no public pull zone is needed.

Under `/api/organizations/:organizationId/rooms/:roomId/attachments`:

- `GET /` lists saved originals with metadata (no object keys or credentials).
- `POST /` accepts multipart `file` and publishes it after storage succeeds.
- `GET /:attachmentId/url` authorizes a 15-minute signed attachment download.
- `DELETE /:attachmentId` marks the file for deletion, removes its object, then
  removes its record. Failed deletions can be retried using the same ID.

Existing organization access rules apply; uploads and removals respect room work
leases. Object keys are generated by the API within the organization and room.
The attachment table retains pending/deleting keys when cleanup fails. Run
`bun run --filter @nautilus/server storage:reconcile` to retry up to 100 cleanup
records (pending uploads must be at least one hour old). Repeat for larger batches.
This command is manual; no background schedule is installed. Room deletion is
restricted while attachment records exist so cleanup keys cannot be lost.

To verify against an **already running local API**, from the repository root run:
`bun --env-file=apps/server/.env apps/server/tests/room-attachments.live.ts`.
It creates isolated users/rooms, tests real Bunny upload/download/deletion plus
existing document saving, and removes its fixtures and objects. It starts no
servers. UI regression: `bun run --filter @nautilus/web test:room-local-save`.

## Scheduler

`src/scheduler` provides one-time, private room-agent events through registered
agent tools and `/api/organizations/:organizationId/rooms/:roomId/schedules`.
See [`skills/scheduler.md`](../../skills/scheduler.md) for tool arguments, HTTP
routes, delivery semantics and local cron testing. The moderator has scheduling
tools; scheduled runs and delegated specialists do not.

Event content, UTC schedules and per-agent delivery records use separate database
tables. Cloudflare Cron runs every minute, claims bounded batches with database
locks and expiring leases, and concurrently enqueues work in the existing room
Durable Objects. Durable receipts prevent duplicate jobs after lost acknowledgements.
Retry attempts are bounded and errors are sanitized. Agent execution and responses
remain private, with live membership/assignment checks and existing room write locks.
Schedules outlive browser sessions. Timing is minute-level and can be delayed by
backlogs. Cancellation/rescheduling is only available before dispatch starts.

Apply migration `20261107190000_scheduler` before deploying this Worker. Builds do
not apply migrations or publish cron triggers. Delivery `accepted` means queued;
execution outcomes are in private agent history (subject to its existing retention).

Verification: `bun test apps/server/tests/scheduler.test.ts
apps/server/tests/private-room-agents.test.ts` and
`bun run --filter @nautilus/server test:room-socket`. The runtime test exercises
scheduled delivery, expired leases, room isolation, owner-only responses and
idempotent acceptance with real Durable Object storage and a stub database/model.

## Shared planner

Kanban and Calendar now use persisted room tasks, reviewed agent tools and linked
one-time scheduler events. Apply `20261109120000_planner` after the scheduler
migration before release. See `skills/planner.md` for API contracts, permissions,
revision handling, scheduling privacy and cancellation behavior. Task due dates
never implicitly schedule agents. The frontend can import existing browser tasks
into an explicitly selected joined room.
