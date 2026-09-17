# Verification record

Last checked: 2026-09-17. This records evidence, not a claim of completed live acceptance.

## Local implementation verification

| Check                           | Result                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript check         | Passed                                                                                                                                            |
| Vitest unit/integration suite   | 103 tests passed in 7 files                                                                                                                       |
| Frontend production build       | Passed; Monaco is loaded on demand with local workers                                                                                             |
| Worker production bundle        | Wrangler dry-run passed; approximately 1 MiB uncompressed                                                                                         |
| D1 migrations                   | Applied successfully to local Wrangler D1; SQL constraints also verified in SQLite tests                                                          |
| Dependency audit                | Zero known vulnerabilities at the last npm install                                                                                                |
| Git serialization               | A real local bare Git repository accepts the generated pack; nested paths, binary bytes, single initial commit, and Git object integrity verified |
| Access identity verification    | Signed JWT tests cover owner, issuer, audience, expiration, and cached signing keys                                                               |
| Import protection               | Traversal, ZIP-slip, secret filtering, binary preservation, path collisions, and size limits tested                                               |
| Provider behavior               | Mocked GitHub and Cloudflare tests; no real provider mutation in automated tests                                                                  |
| Domain safety                   | Confirmation, DNS conflict refusal, stale delegation, and pending SSL behavior tested                                                             |
| Browser isolation               | Preview scripts execute but cannot access parent storage or send external requests                                                                |
| Desktop/mobile browser suite | 10 tests passed on installed Chrome and an emulated iPhone viewport                                                                                        |

Browser tests use local D1 and isolated browser profiles. The domain/deployment browser scenarios use mocked API responses; those screenshots are test evidence, not real deployed websites. Screenshots are generated into ignored `artifacts/`; failures retain traces in ignored `test-results/`.

## Fixes verified during final QA

- Cloudflare Assets normalizes `/preview.html` to `/preview`; both routes now carry the isolated preview policy.
- Monaco diff views detach their models before disposal, avoiding the editor teardown exception.
- Project links retain the project ID, so reloading the editor restores the correct local draft.
- Drafts flush on editor navigation as well as through debounced autosave.
- Updates reuse unchanged Git blob IDs and stage only changed files.
- Deployment retries restart polling; domain inspection retries continue after transient errors.
- Dashboard project cards include the last observed deployment time and verified preview links.
- Hostinger nameserver mutations also check current registrar settings before making a change.

## Production acceptance still requires authorization

Wrangler authorization is present on this computer. A read-only check confirmed there is no existing Worker named `launchdock`. No production LaunchDock resource, repository, DNS record, or provider credential has been created by this implementation session.

The browser is at Cloudflare sign-in. Before deploying:

1. Sign in directly at Cloudflare and verify the account uses Workers Free and Zero Trust Free.
2. Create the LaunchDock D1 database and apply migrations.
3. Configure Access for LaunchDock only, using All traffic and the owner's exact email. Obtain the team domain and application AUD.
4. Register the GitHub OAuth App for the final dashboard callback URL; enter its secret securely through Wrangler.
5. Create and securely back up a production encryption key; install it through Wrangler.
6. Deploy the application and verify authorized access plus rejection of unauthenticated access.
7. Connect GitHub and a scoped Cloudflare token inside the protected dashboard; authorize the Cloudflare GitHub integration.
8. Publish the starter and verify a real repository, one initial commit, a successful Pages build, the live pages.dev website, and one edited update.
9. If a custom domain is provided, verify its delegation and SSL after explicit DNS/nameserver confirmation.

Do not mark this acceptance checklist complete based on mocks. In particular, initial Git smart-HTTP publishing is locally protocol-tested but not yet tested against the user's GitHub account. Representative large imports must also be checked against Workers Free CPU limits; the application never upgrades billing automatically.

## Live handoff fields

- Dashboard URL: not deployed yet.
- LaunchDock source repository: local Git repository only; no remote configured.
- Website test repository: awaiting GitHub OAuth authorization.
- Cloudflare Pages project and pages.dev URL: awaiting authorized live acceptance.
- Custom domain: not selected.
- Remaining account-wide free allowance: unavailable before authenticated account verification. The dashboard's local build count is not an account-wide meter.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [CONNECTIONS.md](CONNECTIONS.md) for exact setup instructions. Never put a credential in this file.

## Connection setup regression checks (2026-09-17)

103 unit/integration tests and all 10 desktop/mobile browser tests pass. Fixed same-origin local forms on port 8787 while preserving production CSRF checks. Missing GitHub OAuth setup now returns to an inline setup guide; the secret-entry helper writes only ignored local configuration. Cloudflare token instructions are visible by default. No real account connection is claimed without provider verification.
