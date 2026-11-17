# Agent Hub

The module owns the roomless compatibility chat (`chat.ts`), document discovery,
permission-scoped knowledge retrieval, and the authenticated durable-run HTTP API.
It composes the existing room moderator, Office skills, planner, progress and
scheduler rather than bypassing their authorization, independent review, revision
checks, or room write lease.

Mounted at `/api/organizations/:organizationId/agent-hub`, behind authentication,
live organization membership, origin checks and no-store responses:

- `GET /rooms`: joined rooms and agents created by the requesting user. First
  invocation registers the selected personal agent with the room.
- `GET /capabilities`: infrastructure availability.
- `GET /rooms/:roomId/history`: the current user's last 50 runs, including tool
  status, source evidence, confirmations and committed document/task revisions.
- `POST /rooms/:roomId/runs`: `{requestId, agentId, instruction, conversationId?,
  knowledge?: ['PERSONAL' | 'ORGANIZATION'], reasoning?: 'low' | 'medium' | 'high'}`.
  Returns 202 after durable acceptance; poll history for text and status updates.
  Retries must reuse the same request ID and exact payload.
- `POST /rooms/:roomId/runs/:runId/cancel`.
- `POST /rooms/:roomId/runs/:runId/confirm`: `{confirmationId, approved}`.

These routes derive identity from the session and forward through the private
`ROOM_CHAT` binding. The coordinator checks the destination room and live access.
Clients cannot provide tools, models, history, write tokens or another user's ID.
Room WebSocket invocations use the same options and execution path.

## Tools and data

Saved document lookup, Word/table reads and edits, spreadsheet range/formula edits,
and reviewed document creation come from Office skills. Kanban and Calendar share
`listTasks`, `readTask`, `createTask`, `updateTask` and `deleteTask`; `date` determines
calendar placement and does not itself schedule execution. Listings now include
calendar dates and agent assignments. Scheduling tools create, list, reschedule
and cancel the user's explicitly requested future work. Private progress tools
provide handover notes, and assigned specialists can prepare reviewed proposals.

`searchKnowledge` and `readKnowledgeEntry` use only enabled buckets. Search is
bounded text matching over existing findings, not semantic search or arbitrary
file ingestion. Every read checks current organization membership, source sharing
permission and source freshness. Replies use returned source IDs for inline
citations; tool cards expose sanitized statuses rather than raw inputs or outputs.
Organization knowledge used for shared edits is revalidated and included in the independent reviewer's evidence. History redacts replies whose knowledge sources become unavailable or stale.

Personal knowledge enables a private read-only run: shared mutations and delegation
are blocked by tool execution guards. Conversation context is isolated by user,
room, agent, conversation ID and enabled knowledge scopes. Task deletion requires
owner-scoped confirmation with a 60-second expiry, before independent review and
the versioned writer. Cancellation declines pending confirmations. Interrupted
runs preserve commits and never automatically replay writes.

The Agents page consumes this API. Existing room chat shares activity, citations,
confirmations and result cards. AI Elements components are adapted to the project's
Base UI primitives; upstream license and attribution are retained in the web app.
The activity disclosure displays observed operations only. Checkpoints link to
saved document versions and do not claim to restore or resume execution. File
pickers and local attachments retain the existing local-only contract.

No database migration or deployment is required by this code change. Live model
execution still needs the existing AI, database, Office and storage bindings.

## Validation

From the repository root:

```sh
bun test apps/server/tests/agent-hub.test.ts apps/server/tests/private-room-agents.test.ts
bun run --filter @nautilus/web test:agent-hub
bun apps/web/tests/agent-hub.browser.mjs # requires a web build and Chromium
bun run --filter @nautilus/server test:room-socket
bun run lint
bun run typecheck
bun run build
```

The DOM and Chromium tests use deterministic API responses; the server tests use
mock database/model boundaries. Database integration tests remain opt-in and need
a dedicated test database. Builds do not deploy or apply migrations.

## Response citations

Hub history and `agent.update` jobs include a top-level `citations` array. The
compatibility JSON chat response includes the same array alongside `text`;
compatibility streaming sends a `data-citations` JSON event before `finish`.
Each record has `id`, `number`, `sourceId`, `sourceType`, `title`, `url`, `scope`,
`quote`, `locator`, `documentVersionId`, and an optional `revision`.

Agents place `[source title](#source-SOURCE_ID)` next to source-based claims.
The backend resolves those markers against successful knowledge/document/task
reads; it ignores unknown IDs and markers in code examples. Document evidence
keeps the saved version and read location; task evidence keeps its revision.
Fetching a source alone does not imply it was cited. An unsourced response returns
an empty citations array. Citation records are rebuilt during streaming and replay,
and are cleared when knowledge is redacted by the existing access/freshness checks.

The chat renders numbered AI Elements Inline Citation badges from these JSON
records. Hovering, keyboard activation or tapping opens the title, evidence,
location, saved document version and a link to the verified source. Legacy jobs
without the new array can derive citations from their existing source metadata.
