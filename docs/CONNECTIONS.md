# Provider connections

## GitHub OAuth App

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**: https://github.com/settings/developers.
2. Name it **LaunchDock Personal**. For local development, set Homepage URL to `http://127.0.0.1:5173` and Authorization callback URL to `http://127.0.0.1:5173/api/auth/github/callback`.
3. For production, create a separate OAuth App with the final HTTPS dashboard origin and the same `/api/auth/github/callback` path. Separate apps prevent local/production callback confusion.
4. In this project's own PowerShell terminal run `npm run setup:github`. Enter the Client ID and generated Client Secret into its prompts; secret input is hidden. The helper preserves the encryption key and saves only to ignored `.dev.vars`. Never send these credentials in chat. Alternatively edit `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.dev.vars` yourself. There is no `VITE_` secret variable.
5. Restart `npm run dev` after editing secrets. Open **Connections → Check GitHub setup**. Once ready, **Authorize GitHub** appears; approve access on GitHub’s page. Before setup, the card displays the exact homepage and callback URLs instead of sending you to a JSON error page.
6. For production, enter each value into the terminal prompts:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

The app requests only OAuth `repo`, the scope needed for private repository creation and updates. This classic OAuth scope is broad: it can access other repositories your account can access. No workflow scope is requested, and workflows are blocked during import. OAuth uses PKCE S256, an encrypted HttpOnly state cookie, a one-use D1 state record, a ten-minute expiry, and cookie cleanup after success or failure. Production cookies are Secure and SameSite=Lax. Tokens are verified through `/user`, then encrypted.

**Reconnect** repeats authorization. **Disconnect** deletes the locally stored token; it does not revoke GitHub’s upstream OAuth grant. For full revocation, use GitHub Settings → Applications → Authorized OAuth Apps → LaunchDock → Revoke.

Source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps and https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps.

## Cloudflare scoped user API token

Use https://dash.cloudflare.com/profile/api-tokens → **Create Token → Create Custom Token**. Do not use a Global API Key.

| Dashboard permission              | Why                                                      |
| --------------------------------- | -------------------------------------------------------- |
| Account → Cloudflare Pages → Edit | Create Pages projects, retry deployments, attach domains |
| Account → Account Settings → Read | List accounts for explicit account selection             |
| Zone → Zone → Read                | Discover the correct zone and assigned nameservers       |
| Zone → Zone → Edit                | Optional: create a new free zone                         |
| Zone → DNS → Edit                 | Optional: add the exact Pages CNAME                      |

Scope Account Resources to your intended account. Scope Zone Resources as narrowly as possible. Creating a zone requires authorization covering the new zone; a token restricted to an existing zone cannot create an unrelated zone. Omit zone/DNS permissions if you only need `pages.dev` hosting.

In **Connections**, enter the token into the password field and select **Verify & connect**. LaunchDock uses `/user/tokens/verify`, then `/accounts`. If multiple accounts are returned, choose one and press the button again. The token is not saved until account selection is complete. The input is cleared after a successful save. A project remains bound to its original Cloudflare account; changing the selected account does not migrate projects.

Cloudflare’s API names permission groups `Pages Write`, `Account Settings Read`, `Zone Read/Write`, and `DNS Write`; the token-creation UI commonly uses Read/Edit labels. Verification confirms token activation and account visibility; feature permissions are additionally exercised when that feature is used. A successful token verification is not a claim that every optional DNS permission is present.

Source: https://developers.cloudflare.com/pages/configuration/api/ and https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/.

## Cloudflare GitHub integration

Cloudflare’s own GitHub App is independent of LaunchDock’s OAuth App. Both are needed.

1. After LaunchDock creates the repository, open Cloudflare **Workers & Pages → Create application → Pages → Connect to Git**.
2. Choose GitHub. Follow Cloudflare’s **Install & Authorize** flow.
3. Grant the Cloudflare GitHub App access to the new repository. Prefer selected repositories. New repositories need to be added to that selection later.
4. Return to LaunchDock and retry **Create Pages & deploy**. LaunchDock creates the source-connected Pages project using the correct repository ID and build configuration.

Cloudflare may reject source configuration until the installation is linked to that Cloudflare account. The error in LaunchDock provides this guided step. A token alone cannot install a GitHub App on your behalf. LaunchDock does not claim an installation exists merely because the API token is active.

Production commits trigger Pages builds. Preview branches are enabled. The dashboard polls observed deployments with increasing delays and stops on a terminal state. No separate deploy hook or extra deployment is triggered on each push.

Source: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/.

## Hostinger

Hostinger’s official current API exposes `GET /api/domains/v1/portfolio`, `GET /api/domains/v1/portfolio/{domain}` and `PUT /api/domains/v1/portfolio/{domain}/nameservers` with `ns1` and `ns2` (optional `ns3`, `ns4`). The official schema was checked on 2026-09-13.

Create a token at https://hpanel.hostinger.com/profile/api. Enter it only in **Connections → Hostinger**. Hostinger tokens inherit the owning user’s permissions, so use an expiry and revoke unused tokens. LaunchDock verifies through read-only portfolio listing. It never asks for a Hostinger password, purchases a domain or hosting plan, transfers a domain, or scrapes hPanel.

If the account rejects API access or nameserver updates, leave Hostinger disconnected and use the manual domain wizard. See [DOMAINS.md](DOMAINS.md).
