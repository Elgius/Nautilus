# Nautilus web

Next.js frontend in the Nautilus Bun workspace. Use Bun 1.3.13 from the repository
root and keep the root `bun.lock`.

## Authentication

The frontend uses the Better Auth React client and organisation plugin. Browser
requests use the same-origin `/api/*` rewrite to the Hono backend, so HTTP-only
session cookies stay on the web origin. No auth token is stored in browser storage.

Set `API_ORIGIN` in `apps/web/.env.local` to the Hono origin. It defaults to
`http://localhost:8787` for local development. Production must use the deployed
backend origin. Configure the backend `WEB_ORIGIN` with the exact web origin;
`BETTER_AUTH_URL` is the backend's canonical auth URL. Both production URLs should
use HTTPS. The frontend never needs database credentials or the auth secret.

| Route | Purpose |
| --- | --- |
| `/login` | Email/password login; invalid-password and unverified-email feedback |
| `/accept-invitation?invitationId=...` | Invitation signup, or acceptance by the signed-in recipient |
| `/verify-email?email=...&invitationId=...` | Verification instructions and resend |
| `/organizations` | Select/switch organisation; platform admins can create organisations |
| `/forgot-password` | Request a reset link |
| `/reset-password?token=...` | Set a new password from the emailed link |
| `/`, `/dashboard`, `/room-id=...` | Server-checked session and active organisation required |

Invited users register with their invited email, name and a password of at least
12 characters. The invitation ID is sent in `X-Invitation-Id`. The verification
callback preserves the invitation and returns to sign in. After sign-in, the
recipient reviews and accepts the invitation. Expired, cancelled and wrong-account
invitations show an error and offer account switching or organisation selection.
There is no public signup flow without an invitation.

A single membership is selected by the backend at sign-in. Several memberships
lead to the picker. Users with no memberships see a waiting state; platform admins
can create the first organisation. Organisation switching and logout discard
cached pages and in-memory state. Browser-only room previews are scoped to both
user and organisation. Rooms, agents and documents remain sample content; this
change connects authentication, organisation identity, invitations and name updates.

The workspace sidebar shows the signed-in user's identity and provides switching
and sign-out. Organisation owners/admins can send invitations from “Invite
teammates” and update the organisation name in Settings. Platform administrators
are distinct from organisation admins; the backend remains the authority for all
permissions and tenant access.

For local development, the backend email outbox is available to the platform admin
at `/api/admin/email-outbox`. Verification and reset emails are not delivered to a
real inbox in outbox mode. Production email still requires the backend provider
configuration. See [backend documentation](../server/README.md).

## Validation

```sh
bun run lint
bun run typecheck
bun run build
bun run --filter @nautilus/web test
```

Tests cover safe login destinations, invitation URL encoding and UI role checks.
The backend has database-backed integration tests for authentication and tenant
isolation. Builds do not start a server or deploy. For browser checks, use the
existing development processes on ports 3000 and 8787.

## Workspace navigation

The `(workspace)` route-group layout owns the authenticated shell for `/`,
`/dashboard`, `/kanban`, and `/calendar`. Sidebar navigation keeps its header,
sidebar, session provider, and view state mounted. The existing `?view=` links
continue to select workspace panels. Room and authentication routes retain their
own layouts and authorization checks.

SWR stores workspace data in a provider scoped to the signed-in user and active
organisation. Room summaries load in the background for the sidebar; agent
profiles load only when their view or a relevant dialog needs them. Successful
mutations update that cache, and focus/reconnect refreshes it. Documents use a
separate metadata endpoint with 50-item pages and server-side search. Each view
has local loading/error UI, so a slow or failed request does not block navigation.

The production browser regression test uses a fixture API on port 8791 and starts
its own Next server on port 3100. It covers persistent navigation, request counts,
slow/error isolation, caching, pagination, mutations, history, and tenant changes.
It never uses the real backend. Install Chromium once, then run from the root:

```sh
bun apps/web/node_modules/playwright/cli.js install chromium
bun run --filter @nautilus/web test:workspace-navigation
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium path.
The test builds the web app with the fixture API origin; run the normal build
again before deployment to use the deployment's configured API origin.
