import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../worker/index";
import type { AppEnv } from "../worker/env";
import { saveConnection, connection, reserveBuild } from "../worker/store";
const origin = "http://127.0.0.1:5173";
let db: DatabaseSync;
let env: AppEnv;
function adapter(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const statement = {
      bind: (...v: (string | number | null)[]) => {
        values = v;
        return statement;
      },
      first: async (column?: string) => {
        const row = db.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      all: async () => ({
        results: db.prepare(sql).all(...values),
        success: true,
        meta: {
          changes: 0,
          duration: 0,
          size_after: 0,
          rows_read: 0,
          rows_written: 0,
          last_row_id: 0,
          changed_db: false,
        },
      }),
      run: async () => {
        const r = db.prepare(sql).run(...values);
        return {
          success: true,
          results: [],
          meta: {
            changes: Number(r.changes),
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: 0,
            last_row_id: 0,
            changed_db: true,
          },
        };
      },
      raw: async () => {
        throw new Error("raw is not used");
      },
    };
    return statement as D1PreparedStatement;
  };
  return { prepare } as D1Database;
}
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  env = {
    DB: adapter(db),
    ASSETS: {
      fetch: async () => new Response("<html>dashboard</html>"),
      connect: () => {
        throw new Error("No sockets in test");
      },
    } as Fetcher,
    APP_ORIGIN: origin,
    LOCAL_DEV: "true",
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    OWNER_EMAIL: "",
    ENCRYPTION_KEY: btoa("x".repeat(32)),
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "client-secret",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected provider call")),
  );
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  worker.fetch(
    new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        "X-LaunchDock": "1",
        "Content-Type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
it("accepts same-origin local Worker requests without trusting other ports", async () => {
  const send = (url: string, requestOrigin: string) =>
    worker.fetch(
      new Request(url + "/api/projects", {
        method: "POST",
        headers: {
          Origin: requestOrigin,
          "X-LaunchDock": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "origin-site",
          repository_name: "origin-site",
          framework_type: "static",
        }),
      }),
      env,
    );
  expect(
    (await send("http://127.0.0.1:8787", "http://127.0.0.1:8787")).status,
  ).toBe(201);
  expect(
    (await send("http://127.0.0.1:8787", "http://127.0.0.1:9000")).status,
  ).toBe(403);
  expect(
    (await send("http://127.0.0.1:8787", "https://evil.example")).status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("shows missing OAuth setup without exposing secrets or navigating to a JSON error", async () => {
  env.GITHUB_CLIENT_SECRET = "";
  const setup = (await (await request("/api/connections")).json()) as {
    data: { setup: { githubReady: boolean; callbackUrl: string } };
  };
  expect(setup.data.setup).toMatchObject({
    githubReady: false,
    callbackUrl: origin + "/api/auth/github/callback",
  });
  expect(JSON.stringify(setup)).not.toContain("client-secret");
  const start = await request("/api/auth/github/start");
  expect(start.status).toBe(302);
  expect(start.headers.get("Location")).toBe(
    origin + "/?oauth=setup#connections",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("migrates all tables, foreign keys and constraints", () => {
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
  ).toHaveLength(5);
  expect(() =>
    db.exec("INSERT INTO connections VALUES('invalid','','','','','','','')"),
  ).toThrow();
  expect(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
});
it("health is public but production API and frontend fail closed", async () => {
  env.LOCAL_DEV = "false";
  expect((await request("/api/health")).status).toBe(200);
  expect((await request("/api/projects")).status).toBe(503);
  expect((await request("/")).status).toBe(503);
  env.ACCESS_TEAM_DOMAIN = "team.cloudflareaccess.com";
  env.ACCESS_AUD = "aud";
  env.OWNER_EMAIL = "me@example.com";
  expect((await request("/api/projects")).status).toBe(401);
});
it("local bypass cannot be enabled on a public hostname", async () => {
  expect(
    (await worker.fetch(new Request("https://evil.example/api/projects"), env))
      .status,
  ).toBe(503);
});
it("blocks cross-origin mutations and missing CSRF header", async () => {
  expect(
    (
      await request(
        "/api/projects",
        "POST",
        {},
        { Origin: "https://evil.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await request("/api/projects", "POST", {}, { "X-LaunchDock": "" })).status,
  ).toBe(403);
});
it("validates schemas, types, body limits and content types", async () => {
  expect(
    (await request("/api/projects", "POST", { name: "../escape" })).status,
  ).toBe(400);
  expect(
    (
      await request(
        "/api/projects",
        "POST",
        {},
        { "Content-Type": "text/plain" },
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await request(
        "/api/projects",
        "POST",
        {},
        { "Content-Length": "13000000" },
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await worker.fetch(
        new Request(origin + "/api/projects", {
          method: "POST",
          headers: {
            Origin: origin,
            "X-LaunchDock": "1",
            "Content-Type": "application/json",
          },
          body: "broken",
        }),
        env,
      )
    ).status,
  ).toBe(400);
});
it("creates metadata without uploading source to a provider", async () => {
  const r = await request("/api/projects", "POST", {
    name: "test-site",
    repository_name: "test-site",
    framework_type: "static",
  });
  expect(r.status).toBe(201);
  const body = (await r.json()) as { data: { id: string } };
  expect((await request("/api/projects/" + body.data.id)).status).toBe(200);
  expect(
    ((await (await request("/api/projects")).json()) as { data: unknown[] })
      .data,
  ).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("encrypts connection tokens and never returns them to browser JS", async () => {
  await saveConnection(env, "github", "highly-secret-token", "owner", "7");
  const raw = db
    .prepare("SELECT encrypted_token FROM connections")
    .get()?.encrypted_token;
  expect(raw).not.toContain("highly-secret-token");
  expect((await connection(env, "github")).token).toBe("highly-secret-token");
  const r = await request("/api/connections");
  const text = await r.text();
  expect(text).not.toContain("encrypted_token");
  expect(text).not.toContain("highly-secret-token");
  expect(text).toContain("owner");
});
it("rejects duplicate or unknown fields and unknown API routes", async () => {
  expect(
    (
      await request("/api/projects", "POST", {
        name: "a",
        repository_name: "a",
        framework_type: "static",
        token: "no",
      })
    ).status,
  ).toBe(400);
  expect((await request("/api/nope")).status).toBe(404);
});
it("secures OAuth cookies, PKCE, state and failed callback cleanup", async () => {
  const start = await request("/api/auth/github/start");
  expect(start.status).toBe(302);
  const url = new URL(start.headers.get("Location")!);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).toBe("repo");
  expect(start.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(db.prepare("SELECT COUNT(*) AS n FROM oauth_states").get()?.n).toBe(1);
  const bad = await request(
    "/api/auth/github/callback?state=invalid&code=secret-code",
    "GET",
    undefined,
    { Cookie: start.headers.get("Set-Cookie")!.split(";")[0] },
  );
  expect(bad.headers.get("Set-Cookie")).toContain("Max-Age=0");
  expect(bad.headers.get("Location")).not.toContain("secret-code");
  expect(fetch).not.toHaveBeenCalled();
});
it("exchanges OAuth once and prevents callback replay", async () => {
  const start = await request("/api/auth/github/start"),
    url = new URL(start.headers.get("Location")!),
    cookie = start.headers.get("Set-Cookie")!.split(";")[0];
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "gh-token" }))
      .mockResolvedValueOnce(Response.json({ id: 7, login: "owner" })),
  );
  const path =
    "/api/auth/github/callback?state=" +
    url.searchParams.get("state") +
    "&code=temporary";
  expect(
    (await request(path, "GET", undefined, { Cookie: cookie })).headers.get(
      "Location",
    ),
  ).toBe(origin + "/#connections");
  expect((await connection(env, "github")).token).toBe("gh-token");
  expect(
    (await request(path, "GET", undefined, { Cookie: cookie })).headers.get(
      "Location",
    ),
  ).toContain("oauth=failed");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("forces account selection and never returns the Cloudflare token", async () => {
  const accounts = [
    { id: "a".repeat(32), name: "One" },
    { id: "b".repeat(32), name: "Two" },
  ];
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ success: true, result: { status: "active" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ success: true, result: accounts }),
      ),
  );
  const r = await request("/api/connections/cloudflare", "POST", {
    token: "never-expose-this-token",
  });
  expect(await r.text()).toContain("selectAccount");
  expect(db.prepare("SELECT COUNT(*) AS n FROM connections").get()?.n).toBe(0);
});
it("disconnect removes credentials without touching external resources", async () => {
  await saveConnection(env, "github", "token", "owner", "7");
  expect((await request("/api/connections/github", "DELETE")).status).toBe(200);
  expect(db.prepare("SELECT COUNT(*) AS n FROM connections").get()?.n).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
it("sets browser security headers and special isolated preview policy", async () => {
  const r = await request("/");
  expect(r.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(r.headers.get("Cache-Control")).toBe("no-store");
  const preview = await request("/preview.html");
  expect(preview.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'none'",
  );
  expect(preview.headers.get("X-Frame-Options")).toBeNull();
});

async function connectedProject() {
  const r = await request("/api/projects", "POST", {
    name: "domain-site",
    repository_name: "domain-site",
    framework_type: "static",
  });
  const {
    data: { id },
  } = (await r.json()) as { data: { id: string } };
  await saveConnection(
    env,
    "cloudflare",
    "cf-token",
    "Account",
    "a".repeat(32),
  );
  db.prepare(
    "UPDATE projects SET cloudflare_project_name=?,cloudflare_account_id=? WHERE id=?",
  ).run("domain-site", "a".repeat(32), id);
  return id;
}
it("returns a structured client error for traversal and file/folder tree collisions", async () => {
  const id = await connectedProject();
  for (const tree of [
    [{ path: "../index.html", sha: "a".repeat(40) }],
    [
      { path: "folder", sha: "a".repeat(40) },
      { path: "folder/file", sha: "b".repeat(40) },
    ],
  ]) {
    const r = await request(`/api/projects/${id}/publish`, "POST", {
      tree,
      expectedHead: "a".repeat(40),
      message: "Update",
      confirm: true,
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
      "VALIDATION",
    );
  }
  expect(fetch).not.toHaveBeenCalled();
});
const zone = {
  id: "z",
  name: "example.com",
  status: "pending",
  name_servers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
};
function domainFetch(records: unknown[] = []) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("cloudflare-dns.com"))
      return Response.json({ Answer: [{ type: 2, data: "old.example.net." }] });
    if (url.includes("/zones?"))
      return Response.json({ success: true, result: [zone] });
    if (url.includes("/dns_records?"))
      return Response.json({ success: true, result: records });
    if (url.includes("/pages/projects/"))
      return Response.json({
        success: true,
        result: { subdomain: "project-1.pages.dev" },
      });
    if (url.endsWith("/domains/example.com"))
      return Response.json({ success: false }, { status: 404 });
    throw new Error("Unexpected mutation: " + init?.method);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
it("does not change DNS without explicit confirmation", async () => {
  const id = await connectedProject(),
    mock = domainFetch();
  expect(
    (
      await request(`/api/projects/${id}/domain`, "POST", {
        domain: "example.com",
        action: "create-zone",
      })
    ).status,
  ).toBe(400);
  expect(
    mock.mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
  ).toBe(true);
});
it("refuses to replace unrelated website DNS records", async () => {
  const id = await connectedProject(),
    mock = domainFetch([
      { id: "r", name: "example.com", type: "A", content: "192.0.2.1" },
    ]);
  const r = await request(`/api/projects/${id}/domain`, "POST", {
    domain: "example.com",
    action: "attach",
    confirm: true,
  });
  expect(r.status).toBe(409);
  expect(await r.text()).toContain("DNS_CONFLICT");
  expect(
    mock.mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
  ).toBe(true);
});
it("requires DNS review and detects stale nameserver confirmation", async () => {
  const id = await connectedProject();
  domainFetch();
  expect(
    (
      await request(`/api/projects/${id}/domain`, "POST", {
        domain: "example.com",
        action: "nameservers",
        confirm: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(`/api/projects/${id}/domain`, "POST", {
        domain: "example.com",
        action: "nameservers",
        confirm: true,
        dnsReviewed: true,
        previous: ["stale.example.net"],
      })
    ).status,
  ).toBe(409);
});
it("reports delegation and SSL pending without claiming a live URL", async () => {
  const id = await connectedProject();
  domainFetch();
  const r = await request(`/api/projects/${id}/domain`, "POST", {
    domain: "example.com",
    action: "inspect",
  });
  expect(((await r.json()) as { data: unknown }).data).toMatchObject({
    delegationActive: false,
    sslStatus: "pending",
    liveUrl: null,
  });
});
it("requires the deployment stage to succeed before marking a site live", async () => {
  const id = await connectedProject();
  let stage = { name: "build", status: "success" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/pages/projects/") && !url.includes("/deployments")) {
        return Response.json({
          success: true,
          result: { subdomain: "preview.pages.dev" },
        });
      }
      return Response.json({
        success: true,
        result: [
          {
            id: "deployment-1",
            url: "https://preview.pages.dev",
            environment: "production",
            created_on: "2026-09-16T00:00:00Z",
            modified_on: "2026-09-16T00:00:01Z",
            latest_stage: stage,
          },
        ],
      });
    }),
  );
  const path = `/api/projects/${id}/deployments?refresh=1`;
  expect(
    (
      (await (await request(path)).json()) as {
        data: { status: string; preview_url: null }[];
      }
    ).data[0],
  ).toMatchObject({ status: "building", preview_url: null });
  stage = { name: "deploy", status: "success" };
  expect(
    ((await (await request(path)).json()) as { data: { status: string }[] })
      .data[0].status,
  ).toBe("successful");
  expect(
    db.prepare("SELECT project_status FROM projects WHERE id=?").get(id)
      ?.project_status,
  ).toBe("live");
});
it("enforces the local monthly build budget before a provider mutation", async () => {
  const id = await connectedProject();
  for (let i = 0; i < 500; i++) await reserveBuild(env, id);
  await expect(reserveBuild(env, id)).rejects.toMatchObject({ status: 429 });
  expect(fetch).not.toHaveBeenCalled();
});
