# Verification record

Checked: 2026-09-17. This document distinguishes local functionality from production hosting.

## Automated checks

- TypeScript: passed.
- Unit and API integration tests: 107 passed across 7 files.
- Production frontend build: passed. Monaco loads on demand; large bundle warnings are informational.
- Local D1 migrations: passed, including SQL constraint verification.
- Desktop/mobile browser coverage: dashboard, import, ZIP validation, Monaco, draft recovery, connections, preview isolation, deployment details and domain wizard. A mobile cold-load timeout was corrected by waiting up to 30 seconds for the lazy editor and explicitly checking imported files.
- Browser tests use port 8790, isolated D1 storage and a disposable environment file. Personal credentials are excluded.

## Real provider checks

- GitHub OAuth: authorized as meharshahid6.
- Cloudflare and Hostinger: official APIs accepted the credentials. Tokens were encrypted in local D1 and successfully read/decrypted for verification after a server restart.
- Existing repositories, zones and DNS records were preserved.
- New private test repository: https://github.com/meharshahid6/launchdock-check-20260917
- Initial commit: 4740b3c8ab0aec7a9937fd86cd5fa6dff4194637
- Updated commit: 6f3e7b13147f68c3dfc95def5b1a7dceaed53cf7
- Cloudflare confirmed the automatic deployment of the update was successful.
- Live website: https://launchdock-check-20260917.pages.dev returned HTTP 200 with the expected updated content.
- A second private test repository/project, launchdock-first-build-20260917, checks deployment from one initial commit without requiring a later push. Initial commit: ef482e38e5222e8e1e36c0c6a88dc4d1d93c0bcd.

## Fixes verified this session

The Worker runtime rejects fetch redirect mode `error`. Provider requests and Git smart HTTP now use `manual`; unexpected redirects do not forward credentials. Real workerd reproduced the original exception. Network errors and unreadable provider responses now have safe, distinct errors.

Pages project creation did not itself queue the first build in the live test. LaunchDock now checks for existing deployments and requests the initial Git build through the official multipart deployment API only when needed. Subsequent Git pushes trigger normal automatic builds.

`LaunchDock.cmd` builds, migrates local D1, starts a hidden server and opens http://127.0.0.1:5173. It was started and verified. `Setup GitHub.cmd` always selects the right project folder. `Open LaunchDock.html` links to the running dashboard; HTML cannot start a backend on its own. The older Administrator-owned server at port 8787 may still have stale environment settings; use 5173.

## Still required for production dashboard hosting

The dashboard itself runs locally; it is not deployed online. Its source repository has no remote. The website test URLs above are deployed websites, not the private dashboard.

The connected Cloudflare account differs from the unrelated account previously cached by Wrangler. Do not deploy using the cached account. Read-only checks of the connected token returned Workers HTTP 403, D1 HTTP 401 and Access HTTP 403. A separately authorized deployment credential or provider setup is required for Workers, D1 and Access before deploying the dashboard. Never paste that credential into chat.

Production requires D1 creation/migrations, a production encryption secret, GitHub's production callback configuration and single-owner Cloudflare Access protection. A custom domain has not been selected; delegation and SSL have not been live-tested. Large imports against Workers Free CPU limits remain unverified. Account-wide remaining free allowance is not available; locally initiated builds are only a partial count.

Credentials exposed in the conversation/screenshots should be rotated through provider settings and the protected local setup fields. No secret values belong in this document.

Final browser run: all 10 desktop/mobile tests passed. The first-build-only test also reached Cloudflare status `successful`, and https://launchdock-first-build-20260917.pages.dev returned HTTP 200 with the expected content.
