import { z, ZodError } from "zod";
import {
  projectInput,
  InputError,
  fileSchema,
  validateFiles,
  LIMITS,
  safePath,
  classifyPath,
  base64,
  bytes,
} from "../shared/validation";
import { authorize, csrf, jsonBody, headers, local } from "./security";
import { AppError, gh, cf, provider } from "./http";
import {
  connection,
  saveConnection,
  project,
  log,
  lock,
  budget,
  reserveBuild,
} from "./store";
import { encrypt, decrypt, hash } from "./crypto";
import { createRepository, pushInitial, commitTree } from "./github";
import {
  pagesHostname,
  verifyCloudflare,
  createPages,
  ensureInitialDeployment,
  type CFDeployment,
} from "./cloudflare";
import { domainAction, domainInput, hostDomains } from "./domains";
import type { AppEnv } from "./env";
import type { Project } from "../shared/model";
const json = (v: unknown, status = 200) =>
  Response.json({ data: v }, { status });
const tokenInput = z
  .object({
    token: z.string().min(20).max(2048),
    accountId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .strict();
const publishInput = z
  .object({
    files: z.array(fileSchema).max(LIMITS.files).optional(),
    tree: z
      .array(
        z
          .object({ path: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/) })
          .strict(),
      )
      .max(LIMITS.files)
      .optional(),
    expectedHead: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    message: z.string().trim().min(1).max(500),
    confirm: z.literal(true),
  })
  .strict();
const cookie = (r: Request, e: AppEnv, value: string, max = 600) =>
  `ld_oauth=${value}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=${max}${local(r, e) ? "" : "; Secure"}`;
async function syncDeployments(e: AppEnv, p: Project) {
  if (!p.cloudflare_project_name) return;
  const c = await connection(e, "cloudflare");
  if (c.provider_account_id !== p.cloudflare_account_id)
    throw new AppError(
      409,
      "ACCOUNT_CHANGED",
      "Reconnect the Cloudflare account used for this project.",
    );
  const productionHost = await pagesHostname(c.token, c.provider_account_id, p.cloudflare_project_name);
  const list = await cf<CFDeployment[]>(
    c.token,
    `/accounts/${c.provider_account_id}/pages/projects/${p.cloudflare_project_name}/deployments?per_page=20`,
  );
  for (const d of list) {
    const stage = d.latest_stage;
    const status =
      stage.status === "failure"
        ? "failed"
        : stage.status === "canceled"
          ? "cancelled"
          : stage.name === "deploy" && stage.status === "success"
            ? "successful"
            : stage.name === "queued"
              ? "queued"
              : "building";
    const m = d.deployment_trigger?.metadata;
    await e.DB.prepare(
      "INSERT INTO deployments(id,project_id,provider_deployment_id,commit_sha,commit_message,environment,status,preview_url,production_url,error_summary,started_time,completed_time,build_command,branch) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider_deployment_id) DO UPDATE SET status=excluded.status,preview_url=excluded.preview_url,production_url=excluded.production_url,error_summary=excluded.error_summary,completed_time=excluded.completed_time",
    )
      .bind(
        d.id,
        p.id,
        d.id,
        m?.commit_hash ?? "",
        m?.commit_message ?? "",
        d.environment,
        status,
        status === "successful" ? d.url : null,
        status === "successful" && d.environment === "production"
          ? `https://${productionHost}`
          : null,
        status === "failed"
          ? `Cloudflare failed during ${stage.name}. Open full build details.`
          : null,
        d.created_on,
        ["successful", "failed", "cancelled"].includes(status)
          ? d.modified_on
          : null,
        d.build_config?.build_command ?? p.build_command,
        m?.branch ?? p.production_branch,
      )
      .run();
  }
  const latest = list.find((d) => d.environment === "production");
  if (latest)
    await e.DB.prepare("UPDATE projects SET project_status=? WHERE id=?")
      .bind(
        latest.latest_stage.status === "failure"
          ? "failed"
          : latest.latest_stage.name === "deploy" &&
              latest.latest_stage.status === "success"
            ? "live"
            : "deploying",
        p.id,
      )
      .run();
}
async function route(r: Request, e: AppEnv): Promise<Response> {
  const u = new URL(r.url),
    path = u.pathname,
    method = r.method;
  if (path === "/api/health") return json({ status: "ok", name: "LaunchDock" });
  await authorize(r, e);
  csrf(r, e);
  if (!path.startsWith("/api/")) return e.ASSETS.fetch(r);
  if (path === "/api/connections" && method === "GET") {
    const rows = await e.DB.prepare(
      "SELECT provider,account_label,provider_account_id,metadata,last_verified_time FROM connections",
    ).all();
    return json({
      connections: rows.results,
      local: local(r, e),
      setup: {
        githubReady: !!(
          e.GITHUB_CLIENT_ID &&
          e.GITHUB_CLIENT_SECRET &&
          e.ENCRYPTION_KEY
        ),
        appOrigin: e.APP_ORIGIN,
        callbackUrl: e.APP_ORIGIN + "/api/auth/github/callback",
        local: local(r, e),
      },
    });
  }
  if (path === "/api/usage" && method === "GET")
    return json({
      initiated: await budget(e),
      limit: 500,
      providerTotal: null,
      note: "Locally initiated builds only. Other tools and GitHub pushes also use your Cloudflare allowance.",
    });
  if (path === "/api/auth/github/start" && method === "GET") {
    if (!e.GITHUB_CLIENT_ID || !e.GITHUB_CLIENT_SECRET || !e.ENCRYPTION_KEY)
      return new Response(null, {
        status: 302,
        headers: { Location: e.APP_ORIGIN + "/?oauth=setup#connections" },
      });
    const state = crypto.randomUUID(),
      verifier = crypto.randomUUID() + crypto.randomUUID();
    await e.DB.prepare("DELETE FROM oauth_states WHERE expires_at<?")
      .bind(Date.now())
      .run();
    await e.DB.prepare("INSERT INTO oauth_states VALUES(?,?)")
      .bind(await hash(state), Date.now() + 600000)
      .run();
    const value = await encrypt(
      JSON.stringify({ state, verifier }),
      e.ENCRYPTION_KEY,
      "oauth",
    );
    const dest = new URL("https://github.com/login/oauth/authorize");
    dest.search = new URLSearchParams({
      client_id: e.GITHUB_CLIENT_ID,
      redirect_uri: e.APP_ORIGIN + "/api/auth/github/callback",
      scope: "repo",
      state,
      code_challenge: await hash(verifier),
      code_challenge_method: "S256",
      allow_signup: "false",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest.href,
        "Set-Cookie": cookie(r, e, encodeURIComponent(value)),
      },
    });
  }
  if (path === "/api/auth/github/callback" && method === "GET") {
    try {
      const value = r.headers
        .get("Cookie")
        ?.split("; ")
        .find((c) => c.startsWith("ld_oauth="))
        ?.slice(9);
      if (!value)
        throw new AppError(
          400,
          "OAUTH_STATE",
          "GitHub sign-in expired. Try connecting again.",
        );
      const saved = JSON.parse(
        await decrypt(decodeURIComponent(value), e.ENCRYPTION_KEY, "oauth"),
      ) as { state: string; verifier: string };
      if (saved.state !== u.searchParams.get("state"))
        throw new AppError(
          400,
          "OAUTH_STATE",
          "GitHub sign-in state is invalid.",
        );
      const consumed = await e.DB.prepare(
        "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash",
      )
        .bind(await hash(saved.state), Date.now())
        .first();
      if (!consumed)
        throw new AppError(
          400,
          "OAUTH_STATE",
          "GitHub sign-in was already used or expired.",
        );
      const code = u.searchParams.get("code");
      if (!code)
        throw new AppError(
          400,
          "OAUTH_DENIED",
          "GitHub authorization was cancelled.",
        );
      const t = await provider<{ access_token?: string }>(
        "https://github.com/login/oauth/access_token",
        "",
        "POST",
        {
          client_id: e.GITHUB_CLIENT_ID,
          client_secret: e.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: e.APP_ORIGIN + "/api/auth/github/callback",
          code_verifier: saved.verifier,
        },
      );
      if (!t.access_token)
        throw new AppError(
          400,
          "OAUTH_EXCHANGE",
          "GitHub did not authorize this connection.",
        );
      const me = await gh<{ id: number; login: string }>(
        t.access_token,
        "/user",
      );
      await saveConnection(
        e,
        "github",
        t.access_token,
        me.login,
        String(me.id),
      );
      return new Response(null, {
        status: 302,
        headers: {
          Location: e.APP_ORIGIN + "/#connections",
          "Set-Cookie": cookie(r, e, "", 0),
        },
      });
    } catch {
      return new Response(null, {
        status: 302,
        headers: {
          Location: e.APP_ORIGIN + "/?oauth=failed#connections",
          "Set-Cookie": cookie(r, e, "", 0),
        },
      });
    }
  }
  if (path === "/api/connections/cloudflare" && method === "POST") {
    const b = tokenInput.parse(await jsonBody(r));
    const accounts = await verifyCloudflare(b.token);
    if (!accounts.length)
      throw new AppError(
        400,
        "NO_ACCOUNTS",
        "No accessible accounts. Add Account Settings Read permission.",
      );
    if (!b.accountId && accounts.length > 1)
      return json({ accounts, selectAccount: true });
    const a = accounts.find((a) => a.id === (b.accountId ?? accounts[0].id));
    if (!a)
      throw new AppError(
        400,
        "ACCOUNT",
        "Choose an account returned by verification.",
      );
    await saveConnection(e, "cloudflare", b.token, a.name, a.id);
    return json({ connected: true });
  }
  if (path === "/api/connections/hostinger" && method === "POST") {
    const b = tokenInput.omit({ accountId: true }).parse(await jsonBody(r));
    await hostDomains(b.token);
    await saveConnection(
      e,
      "hostinger",
      b.token,
      "Hostinger domain portfolio",
      "portfolio",
    );
    return json({ connected: true });
  }
  if (path === "/api/hostinger/domains" && method === "GET") {
    const h = await connection(e, "hostinger");
    return json(await hostDomains(h.token));
  }
  const conn = path.match(
    /^\/api\/connections\/(github|cloudflare|hostinger)(\/verify)?$/,
  );
  if (conn && method === "DELETE" && !conn[2]) {
    await e.DB.prepare("DELETE FROM connections WHERE provider=?")
      .bind(conn[1])
      .run();
    return json({ disconnected: true });
  }
  if (conn && method === "POST" && conn[2]) {
    const c = await connection(e, conn[1]);
    if (conn[1] === "github") await gh(c.token, "/user");
    else if (conn[1] === "cloudflare") await verifyCloudflare(c.token);
    else await hostDomains(c.token);
    await e.DB.prepare(
      "UPDATE connections SET last_verified_time=? WHERE provider=?",
    )
      .bind(new Date().toISOString(), conn[1])
      .run();
    return json({ verified: true });
  }
  if (path === "/api/projects" && method === "GET")
    return json(
      (
        await e.DB.prepare(
          "SELECT p.*,(SELECT d.started_time FROM deployments d WHERE d.project_id=p.id ORDER BY d.started_time DESC LIMIT 1) AS last_deployment_time,(SELECT d.preview_url FROM deployments d WHERE d.project_id=p.id AND d.status='successful' ORDER BY d.started_time DESC LIMIT 1) AS latest_preview_url,(SELECT d.production_url FROM deployments d WHERE d.project_id=p.id AND d.status='successful' AND d.environment='production' ORDER BY d.started_time DESC LIMIT 1) AS latest_production_url FROM projects p ORDER BY p.updated_time DESC",
        ).all()
      ).results,
    );
  if (path === "/api/projects" && method === "POST") {
    const b = projectInput.parse(await jsonBody(r)),
      id = crypto.randomUUID(),
      now = new Date().toISOString();
    await e.DB.prepare(
      "INSERT INTO projects(id,name,description,framework_type,repository_name,production_branch,build_command,root_directory,output_directory,private,created_time,updated_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        b.name,
        b.description,
        b.framework_type,
        b.repository_name,
        b.production_branch,
        b.build_command,
        b.root_directory,
        b.output_directory,
        b.private ? 1 : 0,
        now,
        now,
      )
      .run();
    return json(await project(e, id), 201);
  }
  const m = path.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(.*))?$/);
  if (!m) throw new AppError(404, "NOT_FOUND", "API route not found");
  const p = await project(e, m[1]),
    action = m[2] ?? "";
  if (!action && method === "GET") return json(p);
  if (action === "files" && method === "GET") {
    const c = await connection(e, "github");
    if (!p.repository_id) return json({ files: [], head: null });
    const base = `/repos/${p.repository_owner}/${p.repository_name}`;
    const ref = await gh<{ object: { sha: string } }>(
      c.token,
      `${base}/git/ref/heads/${encodeURIComponent(p.production_branch)}`,
    );
    const tree = await gh<{
      truncated: boolean;
      tree: {
        path: string;
        type: string;
        mode: string;
        sha: string;
        size: number;
      }[];
    }>(c.token, `${base}/git/trees/${ref.object.sha}?recursive=1`);
    if (
      tree.truncated ||
      tree.tree.filter((f) => f.type === "blob").length > LIMITS.files
    )
      throw new AppError(
        413,
        "REPOSITORY_LARGE",
        "Repository exceeds the editor’s safety limits. Clone it locally.",
      );
    if (tree.tree.some((f) => f.mode === "120000" || f.mode === "160000"))
      throw new AppError(
        400,
        "SPECIAL_FILES",
        "Repositories with symlinks or submodules require a local Git editor.",
      );
    return json({
      head: ref.object.sha,
      files: tree.tree.filter((f) => f.type === "blob"),
    });
  }
  if (action === "blobs/read" && method === "POST") {
    const b = z
      .object({ shas: z.array(z.string().regex(/^[a-f0-9]{40}$/)).max(20) })
      .strict()
      .parse(await jsonBody(r));
    const c = await connection(e, "github"),
      out = [];
    for (const sha of b.shas) {
      const blob = await gh<{ content: string; size: number }>(
        c.token,
        `/repos/${p.repository_owner}/${p.repository_name}/git/blobs/${sha}`,
      );
      if (blob.size > LIMITS.file)
        throw new AppError(
          413,
          "FILE_LARGE",
          "A repository file exceeds the editor size limit",
        );
      out.push({
        sha,
        content: blob.content.replace(/\s/g, ""),
        encoding: "base64",
      });
    }
    return json(out);
  }
  if (action === "blobs" && method === "POST") {
    const b = z
      .object({ files: z.array(fileSchema).min(1).max(20) })
      .strict()
      .parse(await jsonBody(r));
    validateFiles(b.files);
    if (!p.repository_id || !p.last_commit_sha)
      throw new AppError(
        400,
        "PUBLISH_FIRST",
        "Publish the initial project first.",
      );
    const c = await connection(e, "github"),
      out = [];
    for (const f of b.files) {
      const blob = await gh<{ sha: string }>(
        c.token,
        `/repos/${p.repository_owner}/${p.repository_name}/git/blobs`,
        "POST",
        { content: base64(bytes(f)), encoding: "base64" },
      );
      out.push({ path: f.path, sha: blob.sha });
    }
    return json(out);
  }
  if (action === "publish" && method === "POST") {
    const b = publishInput.parse(await jsonBody(r));
    if (b.files) validateFiles(b.files);
    if (b.tree) {
      if (!b.tree.length)
        throw new AppError(400, "EMPTY_TREE", "At least one file is required");
      validateFiles(
        b.tree.map((f) => ({
          path: f.path,
          encoding: "utf-8" as const,
          content: "",
        })),
      );
      const seen = new Set();
      for (const f of b.tree) {
        if (safePath(f.path) !== f.path)
          throw new AppError(
            400,
            "PATH",
            "Normalize file paths before publishing",
          );
        if (
          classifyPath(f.path).status !== "accepted" ||
          seen.has(f.path.toLowerCase())
        )
          throw new AppError(400, "PATH", "Invalid or duplicate path");
        seen.add(f.path.toLowerCase());
      }
    }
    return lock(e, p.id, async () => {
      const current = await project(e, p.id),
        c = await connection(e, "github");
      if (
        current.repository_owner &&
        current.repository_owner !== c.account_label
      )
        throw new AppError(
          409,
          "IDENTITY_CHANGED",
          "Reconnect the GitHub account that owns this project.",
        );
      let repoId = current.repository_id,
        owner = current.repository_owner ?? c.account_label,
        sha: string;
      let unchanged = false;
      if (!repoId) {
        if (!b.files || b.expectedHead !== null)
          throw new AppError(
            400,
            "FILES_REQUIRED",
            "Initial publishing requires all validated files and no base commit.",
          );
        const repo = await createRepository(
          c.token,
          owner,
          p.repository_name,
          !!p.private,
        );
        repoId = String(repo.id);
        await e.DB.prepare(
          "UPDATE projects SET repository_id=?,repository_owner=?,project_status=? WHERE id=?",
        )
          .bind(repoId, owner, "repository-created", p.id)
          .run();
      }
      const repo = `${owner}/${p.repository_name}`;
      if (!current.last_commit_sha) {
        if (!b.files)
          throw new AppError(
            400,
            "FILES_REQUIRED",
            "Retry with your original files.",
          );
        let head: string | null = null;
        try {
          head = (
            await gh<{ object: { sha: string } }>(
              c.token,
              `/repos/${repo}/git/ref/heads/${encodeURIComponent(p.production_branch)}`,
            )
          ).object.sha;
        } catch (err) {
          if (!(
            err instanceof AppError &&
            (err.status === 404 || err.code === "PROVIDER_409")
          ))
            throw err;
        }
        if (head) {
          await e.DB.prepare(
            "UPDATE projects SET last_commit_sha=?,project_status=? WHERE id=?",
          )
            .bind(head, "published", p.id)
            .run();
          throw new AppError(
            409,
            "RECOVERED_COMMIT",
            "An existing commit was recovered. Export your draft and reload the repository before pushing further changes.",
          );
        }
        sha = await pushInitial(
          c.token,
          repo,
          p.production_branch,
          b.files,
          b.message,
          owner,
        );
        await gh(c.token, `/repos/${repo}`, "PATCH", {
          default_branch: p.production_branch,
        });
      } else {
        if (!b.tree || !b.expectedHead)
          throw new AppError(
            400,
            "TREE_REQUIRED",
            "Updates require staged blobs and the original branch head.",
          );
        const result = await commitTree(
          c.token,
          repo,
          p.production_branch,
          b.expectedHead,
          b.tree,
          b.message,
          current.cloudflare_project_name
            ? () => reserveBuild(e, p.id)
            : undefined,
        );
        sha = result.sha;
        unchanged = result.unchanged;
      }
      await e.DB.prepare(
        "UPDATE projects SET last_commit_sha=?,last_commit_message=?,project_status=?,updated_time=? WHERE id=?",
      )
        .bind(
          sha,
          b.message,
          unchanged
            ? current.project_status
            : current.cloudflare_project_name
              ? "deploying"
              : "published",
          new Date().toISOString(),
          p.id,
        )
        .run();
      await log(e, p.id, "published", "success", { sha });
      return json({
        repositoryUrl: `https://github.com/${repo}`,
        sha,
        branch: p.production_branch,
        status: "published",
        unchanged,
      });
    });
  }
  if (action === "deploy" && method === "POST") {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(await jsonBody(r));
    if (!p.last_commit_sha)
      throw new AppError(400, "PUBLISH_FIRST", "Publish to GitHub first");
    return lock(e, p.id, async () => {
      const c = await connection(e, "cloudflare"),
        g = await connection(e, "github");
      if (
        p.cloudflare_account_id &&
        p.cloudflare_account_id !== c.provider_account_id
      )
        throw new AppError(
          409,
          "ACCOUNT_CHANGED",
          "Select the original Cloudflare account.",
        );
      if (p.cloudflare_project_name) {
        await ensureInitialDeployment(
          c.token,
          c.provider_account_id,
          p.cloudflare_project_name,
          p.production_branch,
          () => reserveBuild(e, p.id).then(() => {}),
        );
        return json({
          project: p.cloudflare_project_name,
          status: p.project_status,
        });
      }
      await reserveBuild(e, p.id);
      const created = await createPages(
        c.token,
        c.provider_account_id,
        p,
        g.provider_account_id,
      );
      await e.DB.prepare(
        "UPDATE projects SET cloudflare_account_id=?,cloudflare_project_name=?,cloudflare_project_id=?,project_status=?,updated_time=? WHERE id=?",
      )
        .bind(
          c.provider_account_id,
          created.name,
          created.id,
          "deploying",
          new Date().toISOString(),
          p.id,
        )
        .run();
      await ensureInitialDeployment(
        c.token,
        c.provider_account_id,
        created.name,
        p.production_branch,
      );
      return json({
        project: created.name,
        productionUrl: `https://${created.subdomain}`,
        status: "deploying",
      });
    });
  }
  if (action === "deployments" && method === "GET") {
    if (u.searchParams.get("refresh") === "1") await syncDeployments(e, p);
    return json(
      (
        await e.DB.prepare(
          "SELECT * FROM deployments WHERE project_id=? ORDER BY started_time DESC LIMIT 30",
        )
          .bind(p.id)
          .all()
      ).results,
    );
  }
  if (action === "redeploy" && method === "POST") {
    const b = z
      .object({
        deploymentId: z.string().regex(/^[a-f0-9-]{36}$/),
        confirm: z.literal(true),
      })
      .strict()
      .parse(await jsonBody(r));
    return lock(e, p.id, async () => {
      const d = await e.DB.prepare(
        "SELECT id FROM deployments WHERE project_id=? AND provider_deployment_id=?",
      )
        .bind(p.id, b.deploymentId)
        .first();
      if (!d) throw new AppError(404, "DEPLOYMENT", "Deployment not found");
      const c = await connection(e, "cloudflare");
      if (c.provider_account_id !== p.cloudflare_account_id)
        throw new AppError(
          409,
          "ACCOUNT_CHANGED",
          "Select the original Cloudflare account.",
        );
      await reserveBuild(e, p.id);
      await cf(
        c.token,
        `/accounts/${c.provider_account_id}/pages/projects/${p.cloudflare_project_name}/deployments/${b.deploymentId}/retry`,
        "POST",
      );
      return json({ status: "queued" });
    });
  }
  if (action === "domain" && method === "POST") {
    const b = domainInput.parse(await jsonBody(r));
    return b.action === "inspect"
      ? json(await domainAction(e, p, b))
      : lock(e, p.id, async () => json(await domainAction(e, p, b)));
  }
  if (action === "domain/status" && method === "GET") {
    if (!p.custom_domain) return json({ domainStatus: "not-attached" });
    return json(
      await domainAction(e, p, {
        domain: p.custom_domain,
        action: "inspect",
        confirm: false,
        dnsReviewed: false,
      }),
    );
  }
  throw new AppError(404, "NOT_FOUND", "API route not found");
}
export default {
  async fetch(r: Request, e: AppEnv): Promise<Response> {
    let response: Response;
    try {
      response = await route(r, e);
    } catch (error) {
      const known = error instanceof AppError;
      const validation =
        error instanceof ZodError || error instanceof InputError;
      response = Response.json(
        {
          error: {
            code: known
              ? error.code
              : validation
                ? "VALIDATION"
                : "REQUEST_FAILED",
            message:
              known || error instanceof InputError
                ? error.message
                : validation
                  ? "Check the request fields and try again."
                  : "Request could not be completed. Check setup, file paths and provider connections.",
          },
        },
        { status: known ? error.status : validation ? 400 : 500 },
      );
    }
    const secured = new Response(response.body, response);
    for (const [k, v] of Object.entries(headers)) secured.headers.set(k, v);
    if (
      ["/preview", "/preview.html"].includes(new URL(r.url).pathname) &&
      response.ok
    )
      secured.headers.set(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; frame-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      );
    if (["/preview", "/preview.html"].includes(new URL(r.url).pathname))
      secured.headers.delete("X-Frame-Options");
    if (new URL(r.url).protocol === "https:")
      secured.headers.set("Strict-Transport-Security", "max-age=31536000");
    return secured;
  },
};
