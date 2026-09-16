import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  safePath,
  classifyPath,
  validateFiles,
  projectName,
  branchName,
  domainInfo,
  bytes,
  LIMITS,
} from "../shared/validation";
import { importZip, source } from "../src/import";
describe("path normalization", () => {
  it("normalizes Windows relative separators and Unicode", () =>
    expect(safePath("assets\\logo.png")).toBe("assets/logo.png"));
  it.each([
    "../index.html",
    "x/../file",
    "/etc/passwd",
    "C:\\file",
    "\\server\\share",
    "a//b",
    "./index.html",
    "a/./b",
    "a/",
    "a\u0000b",
    "a:stream",
    "a.",
    "a /b",
  ])("rejects unsafe path %s", (p) => expect(() => safePath(p)).toThrow());
  it.each([
    ".env",
    ".env.local",
    "nested/.dev.vars",
    ".npmrc",
    "private.pem",
    "id_ed25519",
    "credentials.json",
    "service-account.json",
    ".github/workflows/deploy.yml",
  ])("blocks secret or workflow %s", (p) =>
    expect(classifyPath(p).status).toBe("blocked"),
  );
  it.each([
    "node_modules/x.js",
    ".git/config",
    "a/.next/cache",
    "__MACOSX/a",
    "assets/.DS_Store",
  ])("ignores dependencies %s", (p) =>
    expect(classifyPath(p).status).toBe("ignored"),
  );
  it("warns on suspicious names", () =>
    expect(classifyPath("password-help.html").reason).toMatch("Review"));
  it("rejects duplicates and file-directory collisions", () => {
    expect(() =>
      validateFiles([
        { path: "A.txt", content: "", encoding: "utf-8" },
        { path: "a.txt", content: "", encoding: "utf-8" },
      ]),
    ).toThrow();
    expect(() =>
      validateFiles([
        { path: "a", content: "", encoding: "utf-8" },
        { path: "a/x", content: "", encoding: "utf-8" },
      ]),
    ).toThrow();
  });
  it("enforces decoded sizes", () =>
    expect(() =>
      validateFiles([
        {
          path: "large.txt",
          encoding: "utf-8",
          content: "a".repeat(LIMITS.file + 1),
        },
      ]),
    ).toThrow());
});
describe("ZIP import", () => {
  it.each([
    "../escape.html",
    "safe/../../escape",
    "/absolute",
    "C:/drive",
    "safe\\..\\escape",
  ])("rejects ZIP traversal %s", (p) =>
    expect(() => importZip(zipSync({ [p]: strToU8("hello") }))).toThrow(),
  );
  it("filters secrets before extraction and preserves binary", () => {
    const raw = new Uint8Array([0, 255, 128, 7]);
    const report = importZip(
      zipSync({
        "index.html": strToU8("<h1>Hello</h1>"),
        "img.png": raw,
        ".env": strToU8("SECRET=hidden"),
        "node_modules/x.js": strToU8("skip"),
      }),
    );
    expect(report.files).toHaveLength(2);
    expect(report.items.find((f) => f.path === ".env")?.status).toBe("blocked");
    expect(bytes(report.files.find((f) => f.path === "img.png")!)).toEqual(raw);
  });
  it("rejects oversized decompressed data", () =>
    expect(() =>
      importZip(zipSync({ "bomb.txt": new Uint8Array(LIMITS.file + 1) })),
    ).toThrow());
  it("does not corrupt invalid UTF-8", () =>
    expect(source("bad.txt", new Uint8Array([255])).encoding).toBe("base64"));
  it("rejects invalid archives", () =>
    expect(() => importZip(strToU8("not a zip"))).toThrow());
});
describe("names and domains", () => {
  it.each(["my-site", "hello2", "a"])("accepts %s", (n) =>
    expect(projectName.safeParse(n).success).toBe(true),
  );
  it.each(["../repo", "Hello", "two words", "a--b", "-a", "a/branch", ".git"])(
    "rejects %s",
    (n) => expect(projectName.safeParse(n).success).toBe(false),
  );
  it("validates branches", () => {
    expect(branchName.safeParse("release/site").success).toBe(true);
    expect(branchName.safeParse("x//y").success).toBe(false);
  });
  it("uses the public suffix list", () =>
    expect(domainInfo("shop.example.co.uk")).toEqual({
      name: "shop.example.co.uk",
      apex: "example.co.uk",
      isApex: false,
    }));
  it.each([
    "https://example.com",
    "localhost",
    "127.0.0.1",
    "a..com",
    "-abc.com",
    "example.com/path",
    "a.github.io",
  ])("rejects unsafe domain %s", (d) => expect(() => domainInfo(d)).toThrow());
});
