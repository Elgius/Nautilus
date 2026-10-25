# Nautilus workspace

- Use Bun 1.3.13 from the repository root; keep one root `bun.lock`.
- `apps/web` is the Next.js frontend. Read its `AGENTS.md` and the installed
  Next.js documentation before changing framework code.
- `apps/server` is the Hono API deployed with Cloudflare Wrangler.
- Run `bun run lint`, `bun run typecheck`, and `bun run build` to validate changes.
  `build:server` is a local dry run; `deploy:server` publishes to Cloudflare.
- Preserve each app's runtime-specific TypeScript options when editing the shared
  `tsconfig.base.json`.
- Room file uploads are browser-local. Selecting or dropping files must not send
  them to S3, create a document version, or start background uploads. Keep original
  `File` objects separate from persisted room documents. S3 upload is a future,
  explicit operation; do not couple it to the file picker, previews, or conversion.
