# Nautilus

Bun workspace monorepo containing the Next.js frontend and Hono API.

```text
apps/
  web/       Next.js frontend (@nautilus/web)
  server/    Hono API on Cloudflare Workers (@nautilus/server)
  office/    Private Bun service for Univer Word/Excel conversion (@nautilus/office)
```

## Getting started

Install Bun 1.3.13, then run these commands from the repository root:

```sh
bun install
bun run dev
```

The frontend runs at http://localhost:3000, the API at http://localhost:8787,
and the Office converter at http://localhost:8790.
Use `bun run dev:web` or `bun run dev:server` to run either app separately.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start both apps in parallel |
| `bun run build` | Bundle the Worker locally and build the frontend |
| `bun run build:web` | Build the Next.js frontend |
| `bun run build:server` | Validate and bundle the Worker without deploying |
| `bun run lint` | Run frontend ESLint |
| `bun run typecheck` | Check TypeScript in both apps |
| `bun run start` | Serve the frontend production build |
| `bun run deploy:server` | Deploy the API to Cloudflare |
| `bun run cf-typegen` | Generate Cloudflare binding types |

The frontend build downloads its Google font and requires network access.
Worker deployment requires Cloudflare credentials.

## Workspace conventions

- Run dependency installs from the root; `bun.lock` is the single lockfile.
- Add app dependencies with `bun add --cwd apps/web <package>` or
  `bun add --cwd apps/server <package>`.
- Each app owns its framework configuration and environment files. Keep frontend
  values in `apps/web/.env.local` and local Worker bindings in
  `apps/server/.dev.vars`.
- Both apps extend `tsconfig.base.json` and retain their runtime-specific settings.
- CI should run `bun install --frozen-lockfile`, `bun run lint`,
  `bun run typecheck`, and `bun run build` from the root.

## Deployments

Agent profiles are stored in Postgres through Prisma. Each agent belongs to an
organization and has a name (unique within that organization, ignoring case),
purpose, avatar icon/color or uploaded image, ordered rules, status, and
creation/update timestamps. Initials are derived from the name. Agent API routes
check current organization membership for every read and write. New organizations
start with no agents; the former Atlas/Nova/Cipher/Sage profiles were sample data.

Apply checked-in database migrations before running the updated API:

```sh
bun run --cwd apps/server db:deploy
```

Use `DATABASE_URL_UNPOOLED` for migrations. The creation dialog sends a description
to `/api/organizations/:organizationId/agent_creator_agent`, which generates a
purpose and rules with the AI SDK before saving the profile. Customization saves
through `/api/organizations/:organizationId/agents/:agentId`. Creation and chat
require the backend Gemini bindings described in `apps/server/README.md`. Uploaded avatars currently retain the existing
2 MB limit and are stored as image data URLs in the agent row.

For Next.js hosting, set the project root directory to `apps/web` and include the
monorepo root in the build context so the root lockfile and workspace are available.
The Next.js configuration traces dependencies from the monorepo root.
Deploy the Worker separately with `bun run deploy:server` from the root.

## Room persistence and S3 documents

### Files from the user's computer

**Upload files** in a room opens a browser-local file picker/dropzone. Users can
select multiple files of different types (up to 20 local files, 10 MiB each).
The browser retains the original `File` objects separately from persisted room
documents. Text, raster images, and PDFs have local previews; other formats retain
their original files for download. Local files are labeled **Local** and disappear
when the room is left or refreshed.

Selecting, dropping, previewing, or switching local files makes no upload or
document-version requests. Local files cannot be attached to a saved chat message.
This flow works without S3 credentials or the Office conversion service. Cloud
uploads are a later feature and must be an explicit action separate from this flow,
as required by `AGENTS.md`.

### Persisted room documents

Rooms, participant memberships, agent assignments, per-user stars, chat messages,
documents, immutable document versions, and message/document links are stored in
Postgres. Documents belong to one room. All organization members can access the
organization's rooms; room participants track involvement rather than private-room
access. APIs check live organization membership on every request, and composite
foreign keys prevent cross-tenant room, agent, document, and version references.

Room metadata and chat work without S3. Set these API environment variables to save
and load document bodies:

```dotenv
S3_BUCKET=your-private-bucket
S3_REGION=your-bucket-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
# Optional temporary credentials and S3-compatible endpoint:
AWS_SESSION_TOKEN=
S3_ENDPOINT=
```

The API signs requests with [aws4fetch](https://github.com/mhart/aws4fetch).
Grant its credentials object read/write access to the room document prefix. Keep
credentials on the API and the bucket private. Explicit saves of persisted editor
documents pass through the API; local file selection never invokes this path.
Bucket CORS configuration is not required for editing. Downloads use signed
GET URLs that expire after 15 minutes.

Each save writes an immutable JSON object at
`organizations/{organizationId}/rooms/{roomId}/documents/{documentId}/versions/{versionId}.json`.
New editor snapshots contain `{ format: "univer", kind, snapshot }`, preserving
rich text, formulas, cell formatting and plugin resources. Existing Markdown and
eight-column spreadsheets are converted when opened; their original history is
retained. Native editor snapshots are validated by the API. Versions are limited to 10 MiB and record
their byte length and SHA-256 checksum. The server checks the expected current
version before committing to prevent stale saves from overwriting another edit.
There is no shared transaction between S3 and Postgres: an unsuccessful database
commit may leave an unreferenced object. Reconcile those objects against version
records before deleting them; referenced history objects must be retained.

The room route and document library read database records, replacing sample rooms
and session storage. Document editors retain drafts when switching files, but saves
are explicit. Chat loads the newest 50 messages with pagination for earlier ones.
Task counts are replaced by document counts; task execution and live collaboration
are not implemented.

Tests use uniquely named database fixtures and a local S3-compatible HTTP test
server; they do not access a real bucket. To run integration checks against a
dedicated development/test database, supply `TEST_DATABASE_URL` and run:

```sh
bun test apps/server/tests
```

## Univer document and spreadsheet editors

Room files use Univer 1.2.0. Documents support rich text and page editing;
spreadsheets include formulas, multiple sheets, sorting, filters, data validation,
and conditional formatting. Editors load only in the browser. Use **Save** to
write a new immutable snapshot; concurrent stale saves are rejected. Switching
room files retains unsaved drafts, and closing a tab with unsaved edits warns the
user. This integration uses versioned saves rather than simultaneous coediting.

**Import Word / Import Excel** opens a shadcn dialog with a drag-and-drop uploader
and a keyboard-accessible file picker. Imports replace the selected file's editor
contents and require a save to persist. Word accepts `.doc`/`.docx`; spreadsheets
accept `.xls`/`.xlsx`/`.csv`/`.tsv`. **Export** downloads the current editor content
as `.docx` or `.xlsx`, including unsaved edits. History downloads are JSON editor
snapshots. Files and snapshots are capped at 10 MiB.

Office conversion uses the official `@univerjs-pro/exchange-node` native SDK in
`apps/office`; it cannot run inside the Cloudflare Worker. Configure it locally:

1. Copy `apps/office/.env.example` to `apps/office/.env`.
2. Generate a random token of at least 32 characters and set `OFFICE_SERVICE_TOKEN`
   in both the converter's `.env` and the API's environment (`.env` or `.dev.vars`).
3. Set `OFFICE_SERVICE_URL=http://127.0.0.1:8790` on the API.
4. Run `bun run dev` from the root, or `bun run dev:office` alongside the web/API.

The converter binds to localhost by default, requires the token for conversion,
and does not store uploaded files. The browser sends uploads through the
organization/room/document API; the service token stays on the API. Unconfigured
conversion disables import/export while keeping editing available. S3
configuration is still required for saving and reloading document contents.

In production, run the converter on a supported macOS arm64, Linux GNU x64/arm64,
or Windows x64 host with Bun. Set `HOST=0.0.0.0` only when needed for container
networking, and expose it privately or through authenticated HTTPS. Configure the
Worker's `OFFICE_SERVICE_URL` and token for that deployment. The root build checks
the converter's TypeScript; deploy/run its source with its installed dependencies
and native binary using `bun run --cwd apps/office start`. Verify Univer's Pro
licensing for the intended deployment; the editor core and commercial packages
have different terms. Keep all Univer SDK versions aligned.

Run the native conversion and compatibility tests with:

```sh
bun test apps/office/tests apps/web/tests apps/server/tests/rooms.test.ts
```

Tests cover DOCX text/edit round trips, XLSX formulas, values, formatting, multiple
sheets, legacy content compatibility, authentication and invalid inputs. Complex
Office layouts and unsupported features should still be checked with representative
user files before claiming full Word/Excel compatibility.

## Repository migration

The former `nautilus/` directory is now `apps/web/`; `nautilus-server/` is now
`apps/server/`. The frontend's Git history has been moved to this repository root.
Existing application source and uncommitted edits were preserved.
