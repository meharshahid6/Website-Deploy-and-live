import { afterEach, it, expect, vi } from "vitest";
import { createRepository, commitTree, pushInitial } from "../worker/github";
import {
  verifyCloudflare,
  createPages,
  ensureInitialDeployment,
} from "../worker/cloudflare";
import type { Project } from "../shared/model";
import { provider } from "../worker/http";
it("uses Worker-compatible manual redirects and never forwards credentials", async () => {
  const mock = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: "https://untrusted.example" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  await expect(
    provider(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      "secret",
    ),
  ).rejects.toMatchObject({ code: "PROVIDER_REDIRECT" });
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock.mock.calls[0][1].redirect).toBe("manual");
});
it("reports network and invalid response failures without leaking provider details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("sensitive provider detail")),
  );
  await expect(
    provider("https://api.github.com/user", "secret"),
  ).rejects.toMatchObject({ code: "PROVIDER_NETWORK" });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("invalid json")),
  );
  await expect(
    provider("https://api.github.com/user", "secret"),
  ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE" });
});
const h = "a".repeat(40),
  t = "b".repeat(40),
  c = "c".repeat(40);
const reply = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => vi.unstubAllGlobals());
it("refuses to overwrite an existing repository", async () => {
  const mock = vi.fn().mockResolvedValue(reply({ id: 1 }));
  vi.stubGlobal("fetch", mock);
  await expect(
    createRepository("token", "owner", "existing", true),
  ).rejects.toMatchObject({ code: "REPOSITORY_EXISTS" });
  expect(mock).toHaveBeenCalledTimes(1);
});
it("creates an empty private repo without an extra commit", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(reply({}, 404))
    .mockResolvedValueOnce(reply({ id: 1 }));
  vi.stubGlobal("fetch", mock);
  await createRepository("token", "owner", "new", true);
  expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({
    name: "new",
    private: true,
    auto_init: false,
  });
});
it("makes a full tree with one parent and never force pushes", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(reply({ object: { sha: h } }))
    .mockResolvedValueOnce(reply({ sha: t }))
    .mockResolvedValueOnce(reply({ tree: { sha: h } }))
    .mockResolvedValueOnce(reply({ sha: c }))
    .mockResolvedValueOnce(reply({}));
  vi.stubGlobal("fetch", mock);
  const result = await commitTree(
    "token",
    "o/r",
    "main",
    h,
    [{ path: "index.html", sha: t }],
    "Update",
  );
  expect(result.sha).toBe(c);
  expect(JSON.parse(mock.mock.calls[1][1].body)).not.toHaveProperty(
    "base_tree",
  );
  expect(JSON.parse(mock.mock.calls[3][1].body).parents).toEqual([h]);
  expect(JSON.parse(mock.mock.calls[4][1].body)).toEqual({
    sha: c,
    force: false,
  });
});
it("stops on stale base commit without a mutation", async () => {
  const mock = vi.fn().mockResolvedValue(reply({ object: { sha: t } }));
  vi.stubGlobal("fetch", mock);
  await expect(
    commitTree("token", "o/r", "main", h, [], "Update"),
  ).rejects.toMatchObject({ code: "HEAD_CHANGED" });
  expect(mock).toHaveBeenCalledTimes(1);
});
it("does not make a commit for unchanged trees", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(reply({ object: { sha: h } }))
    .mockResolvedValueOnce(reply({ sha: t }))
    .mockResolvedValueOnce(reply({ tree: { sha: t } }));
  vi.stubGlobal("fetch", mock);
  expect(
    (await commitTree("token", "o/r", "main", h, [], "Update")).unchanged,
  ).toBe(true);
  expect(mock).toHaveBeenCalledTimes(3);
});
it("requires initial push confirmation from the Git server", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({})));
  await expect(
    pushInitial(
      "token",
      "o/r",
      "main",
      [{ path: "index.html", encoding: "utf-8", content: "hello" }],
      "Initial",
      "owner",
    ),
  ).rejects.toThrow();
});
it("verifies Cloudflare at its official endpoint and lists accounts", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(
      reply({ success: true, result: { status: "active" } }),
    )
    .mockResolvedValueOnce(
      reply({ success: true, result: [{ id: "a", name: "Account" }] }),
    );
  vi.stubGlobal("fetch", mock);
  expect(await verifyCloudflare("token")).toHaveLength(1);
  expect(mock.mock.calls[0][0]).toBe(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
  );
});
const project = {
  name: "site",
  repository_owner: "owner",
  repository_id: "42",
  repository_name: "repo",
  production_branch: "main",
  build_command: "npm run build",
  root_directory: "web",
  output_directory: "dist",
} as Project;
it("starts the first Git build using multipart data when project creation did not queue one", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(reply({ success: true, result: [] }))
    .mockResolvedValueOnce(
      reply({ success: true, result: { id: "deployment" } }),
    );
  vi.stubGlobal("fetch", mock);
  const reserve = vi.fn();
  await ensureInitialDeployment("token", "account", "site", "main", reserve);
  expect(reserve).toHaveBeenCalledOnce();
  expect(mock.mock.calls[1][1].body.get("branch")).toBe("main");
  expect(mock.mock.calls[1][1].headers).not.toHaveProperty("Content-Type");
});
it("does not start another build when a deployment already exists", async () => {
  const mock = vi
    .fn()
    .mockResolvedValue(reply({ success: true, result: [{ id: "existing" }] }));
  vi.stubGlobal("fetch", mock);
  const reserve = vi.fn();
  await ensureInitialDeployment("token", "account", "site", "main", reserve);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(reserve).not.toHaveBeenCalled();
});
it("creates Pages with the correct Git source and build config", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(reply({}, 404))
    .mockResolvedValueOnce(
      reply({ success: true, result: { id: "p", name: "site" } }),
    );
  vi.stubGlobal("fetch", mock);
  await createPages("token", "a", project, "7");
  const body = JSON.parse(mock.mock.calls[1][1].body);
  expect(body.source.config).toMatchObject({
    repo_id: "42",
    owner_id: "7",
    production_deployments_enabled: true,
    preview_deployment_setting: "all",
  });
  expect(body.build_config).toEqual({
    build_command: "npm run build",
    root_dir: "web",
    destination_dir: "dist",
  });
});
it("never adopts a conflicting Pages project", async () => {
  const mock = vi.fn().mockResolvedValue(
    reply({
      success: true,
      result: {
        id: "p",
        name: "site",
        source: { config: { repo_id: "different" } },
      },
    }),
  );
  vi.stubGlobal("fetch", mock);
  await expect(createPages("token", "a", project, "7")).rejects.toMatchObject({
    code: "PAGES_EXISTS",
  });
  expect(mock).toHaveBeenCalledTimes(1);
});
it("does not reflect sensitive provider errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        reply({ token: "secret-token", error: "secret-token" }, 403),
      ),
  );
  await expect(verifyCloudflare("token")).rejects.not.toThrow("secret-token");
});
