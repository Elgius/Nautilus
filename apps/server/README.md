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
starting development; the dev script does this automatically.

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
`src/ai.ts` creates reusable agents with both `generate()` and `stream()` methods.
Their instructions come from the saved agent name, purpose, and ordered rules.
Calls use the AI SDK Google provider (`@ai-sdk/google`) directly, configured per
request from Cloudflare bindings:

- `GOOGLE_GENERATIVE_AI_API_KEY`: Gemini API key; add it to the local `.env` when
  ready and use `bunx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY` from
  `apps/server` for production.
- `AI_MODEL`: Gemini model ID, currently `gemini-3.6-flash` in the environment
  files. The model remains configurable without changing application code.

Both bindings are required for AI creation and chat. Missing configuration
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
100 user messages, with room-scoped cursors. Events are limited to 40 per ten seconds
per connection; text is limited to 20,000 characters.

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

Private jobs are stored in the room Durable Object's SQLite-backed storage under
user-scoped keys. The latest 50 turns per user/room are retained; this is also the
idempotency window for private request IDs. Reconnecting restores private history
and retries unacknowledged invocations with their original ID. An accepted request
is not automatically rerun. Interrupted jobs become failed; “Retry privately” starts
a new request. One private generation per user/room may run at a time, independently
of other users and the human room-message queue. Model output is bounded and errors
are sanitized. AI requires the existing `GOOGLE_GENERATIVE_AI_API_KEY` and `AI_MODEL`
Worker bindings; room messaging and agent selection still work without AI configured.

This private-agent addition uses the existing Durable Object binding and requires
no additional database migration. The room chat migration described above is still
required if it has not already been applied.

Additional checks:

```sh
bun run --filter @nautilus/web test:room-composer
bun run --filter @nautilus/server test:room-socket
```

The composer check runs in an isolated DOM process. Runtime tests verify private
payload isolation across users, same-user tabs, spoofed history owners, duplicate
invocations, unassigned agents, and nonblocking shared chat while an agent streams.
They replace the model provider and database boundary, so they never send private
instructions to a live provider or alter the configured database.
