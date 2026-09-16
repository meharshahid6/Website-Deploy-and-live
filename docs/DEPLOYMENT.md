# Deploy your private dashboard

Use a Cloudflare **Workers Free** account and the Zero Trust **Free** plan. No command here upgrades your plan or enables paid features. If the account is already on a paid plan, its existing billing arrangement is outside LaunchDock’s control; verify the account plan before deploying.

## 1. Authorize the deployment CLI

```sh
npx wrangler login
npx wrangler whoami
```

Approve Cloudflare’s provider page in the browser. This authorization allows the local CLI to deploy the dashboard and create D1. It is separate from the scoped token used inside LaunchDock to manage your websites. Do not share the generated CLI credentials.

Before creation, check existing resources:

```sh
npx wrangler d1 list
npx wrangler deployments list --name launchdock
```

If a Worker or database already uses your chosen name, choose a fresh name. Do not overwrite an unrelated resource. Update `name` and `database_name` in `wrangler.jsonc` together with relevant commands if you choose different names.

## 2. Create a free database

```sh
npx wrangler d1 create launchdock
```

Copy the returned database ID into the `database_id` field in `wrangler.jsonc`. Preserve the `DB` binding name. Then run:

```sh
npm run db:remote
```

This applies versioned SQL migrations. Local and remote databases are separate. Never use a local development export to replace a production database without reviewing it.

## 3. Choose the dashboard URL and configure Access

Use the free Worker hostname `https://launchdock.<your-workers-subdomain>.workers.dev`, or an existing custom hostname. Your deployed user websites get separate free `pages.dev` addresses.

In Cloudflare **Workers & Pages**, find your Workers subdomain. For a `workers.dev` endpoint, open **Workers & Pages → launchdock → Access → Protect this Worker behind Access**, and choose **All traffic** with an Allow policy for your exact email. This protects only LaunchDock, not unrelated Workers. Alternatively use Zero Trust → Access → Applications to configure a self-hosted application for the exact Worker hostname. Cloudflare may require an initial locked deployment to make that hostname appear; the application refuses all private routes until Access configuration is present.

In Cloudflare Zero Trust:

1. Choose the **Free** plan. Create your team name if prompted.
2. Open **Access → Applications → Add an application → Self-hosted**.
3. Cover the exact dashboard hostname and all paths, including `/api/*`, `/assets/*`, `/preview` and the GitHub OAuth callback. Do not create public bypass rules.
4. Create an **Allow** policy with **Include → Emails → your exact email address**. Do not use “Everyone” or a whole email domain. Use your existing identity provider or Access’s one-time PIN. Enter any PIN only on Cloudflare’s page.
5. Copy the application’s **Application Audience (AUD) Tag** and the team domain, such as `my-team.cloudflareaccess.com`.
6. Set these non-secret values in `wrangler.jsonc`:

```json
"vars": {
  "APP_ORIGIN": "https://launchdock.YOUR-SUBDOMAIN.workers.dev",
  "ACCESS_TEAM_DOMAIN": "YOUR-TEAM.cloudflareaccess.com",
  "ACCESS_AUD": "YOUR-APPLICATION-AUDIENCE",
  "OWNER_EMAIL": "YOUR-EXACT-LOGIN-EMAIL",
  "LOCAL_DEV": "false"
}
```

The Worker independently verifies Access JWT signature, issuer, audience, expiry and the owner’s email on **every private route**. Missing configuration returns 503; no Access assertion returns 401. Keep `preview_urls:false` to avoid alternate deployment URLs. If using a custom hostname, either protect the workers.dev hostname too or disable it.

Guide: https://developers.cloudflare.com/workers/configuration/cloudflare-access/ and https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/.

## 4. Create secrets

Create the production GitHub OAuth App with the final URL as described in [CONNECTIONS.md](CONNECTIONS.md). Enter its secrets through the terminal prompts:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

`ENCRYPTION_KEY` must be a base64 encoding of **exactly 32 cryptographically random bytes**, not a passphrase and not a 32-character arbitrary string. Generate it in a trusted local password manager or secure local tool. Keep a recovery copy in that password manager before entering it at the masked Wrangler prompt. Use a separate key from local development. Never put it in Wrangler configuration, chat or source control. Do not replace an existing key without following the rotation procedure.

You do not need GitHub/Cloudflare/Hostinger user tokens as deployment environment secrets. The app obtains and encrypts those through Connections.

## 5. Verify and deploy

```sh
npm run types
npm run typecheck
npm test
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

The preflight refuses missing database IDs, a non-HTTPS production origin, incomplete Access settings, or an enabled local bypass. The Worker itself also fails closed if someone bypasses the preflight. Do not remove these checks to get around authorization setup.

The Worker serves both the dashboard assets and API. There is no second dashboard Pages project to maintain. Wait for Wrangler to return its deployment URL. Open it, complete Access sign-in, and verify that an incognito unauthenticated request cannot access dashboard content or `/api/projects`.

## 6. Live acceptance

1. Connect GitHub through the panel and verify your identity.
2. Connect a scoped Cloudflare token and select the correct account.
3. Import the starter; choose a unique test repository name and private visibility.
4. Publish. Open the repository and confirm one initial commit, HTML/CSS content and branch.
5. Authorize Cloudflare’s GitHub integration, create Pages, wait for Cloudflare to report success, and open its `pages.dev` URL.
6. Change text in Monaco, review the diff and push. Confirm exactly one new commit and the resulting successful deployment.
7. If you have a domain, run the domain wizard. Confirm each zone/DNS/nameserver action and wait for both delegation and Pages SSL activation.

Real repositories, deployments and DNS changes are intentionally never part of automated tests. Record the live dashboard, repository, Pages project and acceptance results in `docs/VERIFICATION.md` after authorization.
