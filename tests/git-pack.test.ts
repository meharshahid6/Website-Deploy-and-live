import { it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { initialPack } from "../shared/git-pack";
it("a real Git receive-pack accepts exactly one root commit with nested binary files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "launchdock-git-"));
  execFileSync("git", ["init", "--bare", dir]);
  const binary = new Uint8Array([0, 255, 128, 3, 10]);
  const result = await initialPack(
    [
      { path: "index.html", encoding: "utf-8", content: "Hello 🌍" },
      {
        path: "a/img.png",
        encoding: "base64",
        content: btoa(String.fromCharCode(...binary)),
      },
      { path: "a.c", encoding: "utf-8", content: "sort order" },
      { path: "a/z.txt", encoding: "utf-8", content: "nested" },
    ],
    "Initial website",
    "main",
    "launchdock",
  );
  const response = execFileSync(
    "git",
    ["receive-pack", "--stateless-rpc", dir],
    { input: result.body },
  ).toString();
  expect(response).toContain("unpack ok");
  expect(response).toContain("ok refs/heads/main");
  expect(
    execFileSync("git", ["--git-dir", dir, "rev-list", "--count", "main"])
      .toString()
      .trim(),
  ).toBe("1");
  expect(
    execFileSync("git", [
      "--git-dir",
      dir,
      "show",
      "main:index.html",
    ]).toString(),
  ).toBe("Hello 🌍");
  expect(
    new Uint8Array(
      execFileSync("git", ["--git-dir", dir, "show", "main:a/img.png"]),
    ),
  ).toEqual(binary);
  expect(
    execFileSync("git", ["--git-dir", dir, "rev-parse", "main"])
      .toString()
      .trim(),
  ).toBe(result.sha);
  execFileSync("git", ["--git-dir", dir, "fsck", "--full"]);
}, 30000);
