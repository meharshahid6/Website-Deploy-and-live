# LaunchDock

**Ship websites without the setup maze.**

A private, single-user React + TypeScript deployment workspace. Import files locally, edit in Monaco, publish one Git commit, deploy through Cloudflare Pages, and connect a custom domain.

## Start locally

Install Node.js 24 LTS and Git. Open a terminal in this folder, then run:

```sh
npm ci
node scripts/local-init.mjs
npm run build
npm run db:local
npm run dev
```

Open **http://127.0.0.1:5173**. Use that exact address, not `localhost`, because OAuth callbacks and request-origin checks must match. The API runs on port 8787; Vite forwards API calls to it. Local D1 state is in `.wrangler/state`. Importing, editing and previewing do not require provider credentials. The local key generator preserves an existing `.dev.vars`.

The local bypass requires both `LOCAL_DEV=true` and an HTTP loopback hostname. The normal production configuration sets it to false. Never expose the local development server through a tunnel.

## First launch

1. Open **New project**. Select files, a folder, a ZIP or the starter.
2. Review accepted, ignored and blocked files. Secret files and dependencies never enter the project. Keep a backup of the original upload.
3. Choose names, visibility, branch and build settings. Existing repositories are never adopted or overwritten.
4. In the editor, review your code and the **Changes** tab. Binary assets stay binary. The local preview supports HTML, CSS, classic scripts and embedded assets; external network calls and navigation are disabled.
5. Open **Connections** and authorize GitHub and Cloudflare using the guides below.
6. Press **Publish to GitHub** and confirm the repository and visibility. You may choose to deploy immediately or publish the repository alone.
7. If Cloudflare requests its GitHub integration, authorize that integration once and retry **Create Pages & deploy**. A repository can be published successfully even if the subsequent Pages step fails; retry Pages rather than republishing files.
8. Open **Deployments**. Wait for **successful**, then use the actual preview or production link.
9. To edit again, open the project. Local drafts are restored first. **Reload from GitHub** replaces the draft only after confirmation; export your ZIP before doing this.

## Setup and deployment guides

- [Production deployment and Access](docs/DEPLOYMENT.md)
- [GitHub OAuth, Cloudflare token and Git integration](docs/CONNECTIONS.md)
- [Hostinger and custom domains](docs/DOMAINS.md)
- [Security, free-tier limits and recovery](docs/OPERATIONS.md)
- [API reference](docs/API.md)
- [Verification record and outstanding live acceptance](docs/VERIFICATION.md)

Never paste passwords, one-time codes, API tokens, client secrets or encryption keys into chat, issue reports or logs. Enter provider API tokens only in the local/private Connections page. Enter Worker secrets through `wrangler secret put`, which prompts securely. GitHub OAuth client secrets belong only on the Worker or in ignored local `.dev.vars`.

## Commands

| Command                | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`          | Local Worker + Vite, loopback only                                                      |
| `npm run types`        | Regenerate binding/runtime types after Wrangler config changes                          |
| `npm run typecheck`    | Strict TypeScript checks                                                                |
| `npm test`             | Unit tests, mocked provider routes, SQLite migrations, real local Git pack verification |
| `npm run build`        | Production dashboard with self-hosted Monaco workers                                    |
| `npm run test:browser` | Chrome desktop/mobile tests against local production assets + Worker                    |
| `npm run db:local`     | Apply local D1 migrations                                                               |
| `npm run db:remote`    | Apply migrations to the configured remote database                                      |
| `npm run deploy:check` | Refuse deployment when Access/origin/database config is missing                         |
| `npm run deploy`       | Preflight, type check, frontend build, Worker deployment                                |

Browser tests use an isolated Chrome profile. Chrome must be installed; alternatively change the Playwright channel and install Chromium. No test invokes real provider mutation APIs. Browser tests create test projects only in an isolated `.wrangler/browser-state` database. Stop the local development server on port 8787 before running them.

## Architecture

`src/` contains React, the browser import validator, Monaco and IndexedDB drafts. `shared/` contains file/project validation and Git object serialization. `worker/` contains Access verification, CSRF, encrypted connections, provider adapters and API routes. `migrations/` contains D1 schema changes. Source files are not stored in D1. GitHub is canonical after publishing; D1 stores metadata, encrypted tokens and deployment history.

All dashboard requests run through the Worker, including assets, so an unconfigured or bypassed Access gateway cannot expose the private app. Only `/api/health` is public. The isolated preview wrapper has its own restrictive CSP and nested opaque sandbox; project scripts do not execute in the dashboard origin. No CDN, paid authentication, R2, analytics, billing, teams or public registration is used.

GitHub REST cannot initialize a branch in an empty repository. LaunchDock uses the standard Git smart-HTTP receive-pack protocol for the first upload: blobs, nested trees, one root commit and one branch update. Later pushes use the GitHub blob/tree/commit/reference APIs with the expected parent and `force:false`. Full replacement trees represent deletions. A local Git integration test verifies the initial pack format and exact binary bytes. A live GitHub acceptance run is still required after OAuth setup.

Framework projects must emit static output for Pages. Vite and Astro are detected; other frameworks require explicit build/output settings. SSR runtimes, Git LFS, submodules, symlinks and uploaded GitHub Actions workflows are outside this personal static-site tool’s supported scope. Monaco’s TypeScript worker is a large lazy-loaded asset; it is self-hosted and below Cloudflare’s per-asset limit.
