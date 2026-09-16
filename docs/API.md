# Worker API

All routes except health require Access in production. Writes require `Origin` exactly equal to `APP_ORIGIN`, `X-LaunchDock: 1`, and JSON `Content-Type`. No CORS wildcard is sent.

Success: `{ "data": ... }`. Error: `{ "error": { "code": "...", "message": "safe explanation" } }` with an appropriate HTTP status. Provider error bodies are never returned. OAuth routes use redirects and HttpOnly cookies.

| Method / route                           | Input / behavior                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                        | Public liveness only                                                                                                       |
| `GET /api/connections`                   | Provider, label, selected account, verification time; no token                                                             |
| `GET /api/auth/github/start`             | PKCE OAuth redirect                                                                                                        |
| `GET /api/auth/github/callback`          | Consumes one-use state, exchanges code, stores encrypted token                                                             |
| `POST /api/connections/cloudflare`       | `{token, accountId?}`; may return accounts for selection without storing                                                   |
| `POST /api/connections/hostinger`        | `{token}`; verifies domain portfolio                                                                                       |
| `POST /api/connections/:provider/verify` | Recheck provider and update verification time                                                                              |
| `DELETE /api/connections/:provider`      | Delete local credential only                                                                                               |
| `GET /api/hostinger/domains`             | Read official Hostinger portfolio                                                                                          |
| `GET /api/usage`                         | Local monthly requests and budget; provider total is unavailable/null                                                      |
| `GET /api/projects`                      | Metadata list, newest updated first                                                                                        |
| `POST /api/projects`                     | Names, visibility, framework, branch, build/root/output settings; no source upload                                         |
| `GET /api/projects/:id`                  | Project metadata                                                                                                           |
| `GET /api/projects/:id/files`            | Current branch head and full file manifest; rejects oversized/special repositories                                         |
| `POST /api/projects/:id/blobs/read`      | `{shas:[...]}`; at most 20 blobs per call                                                                                  |
| `POST /api/projects/:id/blobs`           | `{files:[{path,content,encoding}]}`; at most 20 validated files; returns paths/SHAs                                        |
| `POST /api/projects/:id/publish`         | Initial: `{files,expectedHead:null,message,confirm:true}`; update: `{tree:[{path,sha}],expectedHead,message,confirm:true}` |
| `POST /api/projects/:id/deploy`          | `{confirm:true}`; create/recover a matching source-connected Pages project                                                 |
| `GET /api/projects/:id/deployments`      | Cached D1 history; `?refresh=1` fetches up to 20 latest provider deployments                                               |
| `POST /api/projects/:id/redeploy`        | `{deploymentId,confirm:true}`; ID must belong to this project                                                              |
| `POST /api/projects/:id/domain`          | `{domain,action,confirm?,previous?,dnsReviewed?}`; actions `inspect`, `create-zone`, `nameservers`, `attach`               |
| `GET /api/projects/:id/domain/status`    | Inspect saved domain, delegation and Pages validation                                                                      |

`encoding` is `utf-8` or `base64`. Binary payloads must use base64. Paths are relative POSIX paths after normalization. A publish is an entire project snapshot; omitted paths represent deletions. The server rejects protected paths. Updates require a base head from the repository load. Conflict responses require user review, not automatic retries or force-push.

Creation/push/deploy are separate recoverable operations. If GitHub succeeds and Pages fails, the repository and commit remain saved. If a mutation’s response is uncertain, inspect provider state before retrying. Project leases prevent overlapping mutations for three minutes; a crashed lease expires automatically. Provider timeouts have sanitized errors.

The API is a private application interface, not a public multi-user publishing service. Do not place it behind a public Access bypass policy.
