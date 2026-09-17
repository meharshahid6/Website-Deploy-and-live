# Security, limits and recovery

Local development accepts the configured frontend origin and the exact same origin as a loopback HTTP Worker request. This lets the dashboard served on port 8787 submit forms while the Vite frontend uses 5173. Other origins and ports remain blocked; production still requires the exact configured APP_ORIGIN and X-LaunchDock header. Use the Connections card's configured callback URL for GitHub OAuth even when viewing built assets on 8787.

## Security boundaries

- Access JWTs are verified on the Worker with RS256, the configured issuer/audience and exact owner email. Headers claiming an email without a valid signed JWT are insufficient.
- Every state-changing API requires an exact Origin match and `X-LaunchDock: 1`. Request bodies must be JSON and are read with a streaming byte cap.
- OAuth state is random, encrypted in a short-lived HttpOnly cookie and single-use in D1. PKCE S256 protects the code exchange. Both success and failure clear the cookie.
- Tokens use AES-256-GCM with a fresh random 12-byte IV and provider-specific authenticated context. The master key is exactly 32 bytes. The database never contains plaintext provider tokens.
- Connections responses omit the encrypted envelope and token. Disconnect deletes the stored credential; revoke the upstream grant/token at the provider for full disconnection.
- Browser provider-token input is necessarily present only while you enter it. Tokens returned by OAuth or stored in D1 never enter frontend JavaScript. Token fields are cleared after successful connection and are not stored in IndexedDB.
- Logs contain allowlisted action identifiers and safe metadata. Provider bodies, OAuth codes, request headers, cookies, tokens and encryption keys are not logged. Worker request observability is disabled to avoid collecting callback query strings. Use the sanitized D1 activity log and provider dashboards for diagnostics.
- Uploaded code runs only in an opaque sandbox. The preview wrapper is also sandboxed, does not expose authenticated APIs, and permits no network connections. Monaco and workers are bundled locally; there is no CDN loader.
- Import rejects absolute paths, traversal, ambiguous paths, collisions, dangerous credential filenames, private keys, certificates and GitHub Actions workflows. Dependencies, Git metadata and build caches are ignored. ZIP expansion and entry counts are bounded.
- This is not a general secret scanner. Review accepted source code for embedded credentials before publishing. Obfuscated, unknown or hardcoded secrets cannot reliably be identified by filenames.
- GitHub writes never force-push. A changed remote head refuses the update. Per-project D1 leases serialize publishing, deploy and domain mutations. Failed external mutations leave resources intact for recovery.

## Free-tier assumptions

Official documentation checked **2026-09-13**. Recheck these sources before changing caps or displaying new quotas.

| Service          | Verified free allowance / behavior                                                                    | Source                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cloudflare Pages | 500 builds/month, one concurrent build; build timeout 20 minutes                                      | https://developers.cloudflare.com/pages/platform/limits/                        |
| Pages assets     | 20,000 files/site, 25 MiB maximum asset                                                               | Same Pages limits page                                                          |
| Workers Free     | 100,000 requests/day, 10 ms CPU/request, 128 MB memory, 50 external subrequests/request               | https://developers.cloudflare.com/workers/platform/limits/                      |
| D1 Free          | 5 million rows read/day, 100,000 rows written/day, 5 GB account storage                               | https://developers.cloudflare.com/d1/platform/pricing/                          |
| GitHub OAuth API | Normally 5,000 authenticated requests/hour shared with other API clients; secondary limits also apply | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| Access           | Free plan available; select Free for this single-user app                                             | https://www.cloudflare.com/plans/zero-trust-services/                           |
| Hostinger        | Existing domain and renewal fees; token inherits account permissions, API rate limiting returns 429   | https://developers.hostinger.com/                                               |

LaunchDock’s own caps are deliberately lower: **500 imported files, 2 MiB per file, 8 MiB total source, 12 MiB JSON request body, 20 GitHub blobs per API request**. These are application safety caps, not Cloudflare or GitHub published maxima. ZIP extraction is local. Blob requests are sequential within batches, staying below the Worker’s external subrequest cap. Very large projects can still approach the 10 ms Free CPU allowance during validation/serialization; verify representative workloads in production and reduce project size if Cloudflare returns a resource-limit error. There is no automatic upgrade to a paid plan.

Build counts in the dashboard are a **local budget of build-triggering requests**, not Cloudflare’s complete account usage. GitHub pushes outside LaunchDock, other Pages projects and provider retries can consume additional builds. Failed or uncertain requests may reserve budget conservatively. LaunchDock warns at 400 and blocks new local build reservations at 500 per UTC calendar month. No authoritative account-wide Pages monthly usage API is assumed; the UI links to Cloudflare for the total. No-op commits are skipped. Auto-push is opt-in, waits two minutes idle, then disables itself after one attempt.

Keep Workers, Pages, D1 and Zero Trust on their Free plans. This project has no R2, paid logging, analytics, AI, queues, paid storage or automatic overage settings. Account upgrades made outside LaunchDock may change provider billing. Domain registration and renewal are the only intended external expense.

## Backup

1. **Source:** GitHub is canonical after publishing. Periodically `git clone --mirror` important repositories to your own backup drive. In-progress local drafts need **Export ZIP** before clearing browser storage or changing machines.
2. **Metadata:** export D1 to an ignored backup directory:

```sh
npx wrangler d1 export launchdock --remote --output=artifacts/launchdock-backup.sql
```

3. **Secrets:** keep the production encryption key and OAuth App credentials in a password manager. A database backup alone cannot decrypt tokens without the correct master key. Treat the database export as sensitive even though tokens are encrypted.
4. **Configuration:** keep Wrangler config, migrations and application source in a private Git repository. `.dev.vars`, exports and build artifacts are ignored.

## Restore

Restore into a **new** free D1 database first. Inspect the SQL export and verify the destination ID. Use `wrangler d1 execute NEW_DATABASE --remote --file=...` for the reviewed backup, then point a locked staging Worker at it and configure the original encryption key. Do not import over a live database blindly. If only metadata is lost, your GitHub repositories and Pages deployments remain. Keep a resource inventory in the verification record so you can reconnect manually.

Local drafts are not backed up by D1. Deleted or cleared browser storage cannot be recovered from the server if it was never published/exported.

## Key rotation / loss

For this personal version, the simplest safe rotation is: export D1, verify backups, disconnect all three providers in LaunchDock, replace `ENCRYPTION_KEY` via `wrangler secret put`, then reconnect providers. Do not change the key while encrypted connection rows still need to be read. GitHub repositories and Pages projects remain unchanged. If the old key is lost, remove the unusable connection rows through the D1 console and reconnect; encrypted tokens cannot be recovered.

## Troubleshooting

- **503 “Dashboard is locked”:** configure Access team domain, audience and owner email. Never enable the local bypass in production.
- **403 request origin:** use the exact configured origin, with no trailing slash. Check `APP_ORIGIN` after switching from local to production.
- **GitHub callback failed:** check the exact callback URL, OAuth App client ID/secret, and that the callback path is covered by Access. Restart after local secret edits. Reconnect to obtain fresh one-use state.
- **GitHub head changed:** export your draft, reload GitHub, merge your changes manually in the editor, then push. LaunchDock will not force-push over outside changes.
- **Initial commit response lost:** the next attempt detects an existing branch, records its head, and requests that you reload GitHub before further updates. An empty repository from a failed attempt remains linked to the project so it can be retried.
- **Repository already exists:** choose a different name. Existing-repository adoption is intentionally refused; it prevents accidental full-tree replacement.
- **Pages setup failed after publish:** authorize Cloudflare’s GitHub integration for that repository, check account and Pages permissions, then retry Pages creation. Do not create a Direct Upload project: source-connected projects are required here.
- **Provider revoked token:** Connections → Reconnect or replace token. Disconnect alone does not revoke upstream access.
- **Pending build:** Cloudflare may queue builds on Free. Open full Cloudflare details for logs. Error summaries here omit provider bodies to avoid secret disclosure.
- **Local draft save failed:** storage may be full, disabled or unavailable in private browsing. Export a ZIP before leaving.
- **Framework preview blank:** local preview supports static source only. Build and use the returned Pages preview URL. Relative ES module dependency graphs and dynamic imports need a real build.
- **Worker error 1102:** reduce project size and retry; Free CPU limits are fixed. Do not upgrade billing automatically.
- **Windows esbuild permissions:** a restrictive OS sandbox may prevent reading parent directories while bundling. Run the verified local build in a normal terminal with access to this project, without changing application security settings.
