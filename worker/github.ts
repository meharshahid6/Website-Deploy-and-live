import { gh, AppError } from "./http";
import { initialPack } from "../shared/git-pack";
import type { SourceFile } from "../shared/model";
export interface Repository {
  id: number;
  name: string;
  html_url: string;
  default_branch: string;
  owner: { login: string; id: number };
}
export async function createRepository(
  token: string,
  owner: string,
  name: string,
  isPrivate: boolean,
) {
  let existing = false;
  try {
    await gh(token, `/repos/${owner}/${name}`);
    existing = true;
  } catch (e) {
    if (!(e instanceof AppError && e.status === 404)) throw e;
  }
  if (existing)
    throw new AppError(
      409,
      "REPOSITORY_EXISTS",
      "This repository already exists. Choose a new name. LaunchDock will not adopt or overwrite it.",
    );
  return gh<Repository>(token, "/user/repos", "POST", {
    name,
    private: isPrivate,
    auto_init: false,
  });
}
export async function pushInitial(
  token: string,
  repo: string,
  branch: string,
  files: SourceFile[],
  message: string,
  identity: string,
) {
  const auth = {
    Authorization: `Basic ${btoa("x-access-token:" + token)}`,
    "User-Agent": "LaunchDock",
  };
  const advertisement = await fetch(
    `https://github.com/${repo}.git/info/refs?service=git-receive-pack`,
    { headers: auth, redirect: "manual", signal: AbortSignal.timeout(25000) },
  );
  if (!advertisement.ok) {
    await advertisement.body?.cancel();
    throw new AppError(
      502,
      "GIT_AUTH",
      "GitHub Git access could not be verified. Reconnect GitHub.",
    );
  }
  const capabilities = await advertisement.text();
  if (!capabilities.includes("report-status"))
    throw new AppError(
      502,
      "GIT_PROTOCOL",
      "GitHub did not advertise push confirmation support.",
    );
  const pack = await initialPack(files, message, branch, identity);
  const r = await fetch(`https://github.com/${repo}.git/git-receive-pack`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa("x-access-token:" + token)}`,
      "Content-Type": "application/x-git-receive-pack-request",
      Accept: "application/x-git-receive-pack-result",
      "User-Agent": "LaunchDock",
    },
    body: pack.body,
    redirect: "manual",
    signal: AbortSignal.timeout(60000),
  });
  const result = await r.text();
  if (
    !r.ok ||
    !result.includes("unpack ok") ||
    !result.includes(`ok refs/heads/${branch}`) ||
    result.includes("\nng ")
  )
    throw new AppError(
      502,
      "INITIAL_PUSH",
      "GitHub did not confirm the initial commit. The repository is preserved. Retry after checking its branch.",
    );
  return pack.sha;
}
export async function commitTree(
  token: string,
  repo: string,
  branch: string,
  expected: string,
  tree: { path: string; sha: string }[],
  message: string,
  beforePush?: () => Promise<void>,
) {
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  if (ref.object.sha !== expected)
    throw new AppError(
      409,
      "HEAD_CHANGED",
      "GitHub changed since this draft was opened. Export your draft, then reload the repository and merge your changes.",
    );
  const t = await gh<{ sha: string }>(
    token,
    `/repos/${repo}/git/trees`,
    "POST",
    { tree: tree.map((f) => ({ ...f, mode: "100644", type: "blob" })) },
  );
  const parent = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${repo}/git/commits/${expected}`,
  );
  if (parent.tree.sha === t.sha) return { sha: expected, unchanged: true };
  const c = await gh<{ sha: string }>(
    token,
    `/repos/${repo}/git/commits`,
    "POST",
    { message, tree: t.sha, parents: [expected] },
  );
  if (beforePush) await beforePush();
  await gh(
    token,
    `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    "PATCH",
    { sha: c.sha, force: false },
  );
  return { sha: c.sha, unchanged: false };
}
