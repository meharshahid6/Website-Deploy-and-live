import { z } from "zod";
import { parse } from "tldts";
import type { SourceFile } from "./model";
export class InputError extends Error {}
// Application safety caps, intentionally below provider maxima. Never marketed as provider quotas.
export const LIMITS = {
  files: 500,
  total: 8 * 1024 * 1024,
  file: 2 * 1024 * 1024,
  request: 12 * 1024 * 1024,
  blobBatch: 20,
  monthlyBuilds: 500,
};
export function safePath(input: string): string {
  if (
    !input ||
    input.length > 240 ||
    /^[\\/]|^[a-z]:/i.test(input) ||
    /[\x00-\x1f\x7f<>:"|?*]/.test(input)
  )
    throw new InputError("Invalid or absolute file path");
  const parts = input.replaceAll("\\", "/").normalize("NFC").split("/");
  if (parts.some((p) => p === ".." || !p || p === "." || /[. ]$/.test(p)))
    throw new InputError("Traversal or ambiguous path blocked");
  return parts.join("/");
}
export function classifyPath(path: string): {
  status: "accepted" | "ignored" | "blocked";
  reason: string;
} {
  const p = safePath(path).toLowerCase(),
    parts = p.split("/"),
    name = parts.at(-1)!;
  if (
    parts.some((x) =>
      [
        ".git",
        "node_modules",
        "vendor",
        ".next",
        ".nuxt",
        ".cache",
        ".turbo",
        ".wrangler",
        "__macosx",
        ".idea",
      ].includes(x),
    ) ||
    name === ".ds_store" ||
    name === "thumbs.db" ||
    name.startsWith("._")
  )
    return {
      status: "ignored",
      reason: "Dependency, cache or system metadata",
    };
  if (
    parts.some((x) => /^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/.test(x)) ||
    /\.(pem|key|p12|pfx|crt|cer|jks|keystore)$/.test(name) ||
    /^(id_rsa|id_ed25519|id_ecdsa|credentials|service-account|service_account|secrets)(\.|$)/.test(
      name,
    ) ||
    [".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(name) ||
    p.startsWith(".github/workflows/")
  )
    return {
      status: "blocked",
      reason: "Secret material or executable GitHub workflow",
    };
  return {
    status: "accepted",
    reason: /token|password|credential|secret/i.test(name)
      ? "Review: filename may contain sensitive information"
      : "",
  };
}
export const projectName = z
  .string()
  .min(1)
  .max(58)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens",
  );
export const branchName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/)
  .refine((x) => !x.includes("//") && !x.endsWith("/"));
const directory = z
  .string()
  .max(200)
  .refine(
    (x) =>
      x === "" ||
      x === "." ||
      (() => {
        try {
          return safePath(x) === x;
        } catch {
          return false;
        }
      })(),
    "Use a relative directory without traversal",
  );
export const projectInput = z
  .object({
    name: projectName,
    description: z.string().max(500).default(""),
    repository_name: projectName,
    framework_type: z.enum(["static", "vite", "astro", "framework"]),
    production_branch: branchName.default("main"),
    build_command: z.string().max(500).default(""),
    root_directory: directory.default(""),
    output_directory: directory.default(""),
    private: z.boolean().default(true),
  })
  .strict();
export const fileSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(["utf-8", "base64"]),
  })
  .strict();
export function bytes(f: SourceFile): Uint8Array<ArrayBuffer> {
  try {
    return f.encoding === "base64"
      ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(f.content);
  } catch {
    throw new InputError("Invalid base64 file content");
  }
}
export function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192)
    s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}
export function validateFiles(files: SourceFile[]): SourceFile[] {
  if (!files.length || files.length > LIMITS.files)
    throw new InputError(`Import 1–${LIMITS.files} files`);
  let total = 0;
  const seen = new Set<string>();
  for (const f of files) {
    f.path = safePath(f.path);
    if (classifyPath(f.path).status !== "accepted")
      throw new InputError(`Blocked path: ${f.path}`);
    if (seen.has(f.path.toLowerCase()))
      throw new InputError(`Duplicate path: ${f.path}`);
    seen.add(f.path.toLowerCase());
    const n = bytes(f).length;
    total += n;
    if (n > LIMITS.file || total > LIMITS.total)
      throw new InputError("Project exceeds LaunchDock safety size limits");
  }
  for (const path of seen)
    for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1))
      if (seen.has(path.slice(0, i)))
        throw new InputError("File and folder paths collide");
  return files;
}
export function domainInfo(input: string) {
  const name = input.toLowerCase().trim().replace(/\.$/, "");
  const p = parse(name, { allowPrivateDomains: true });
  if (
    !p.domain ||
    !p.isIcann ||
    p.isIp ||
    name.length > 253 ||
    !name
      .split(".")
      .every(
        (x) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x) && x.length <= 63,
      )
  )
    throw new InputError("Enter a valid public domain, without a URL or path");
  return { name, apex: p.domain, isApex: name === p.domain };
}
export function detect(files: SourceFile[]) {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg)
    return {
      framework_type: "static" as const,
      build_command: "",
      output_directory: "",
    };
  try {
    const p = JSON.parse(pkg.content),
      d = { ...p.dependencies, ...p.devDependencies };
    return {
      framework_type: d.astro
        ? ("astro" as const)
        : d.vite
          ? ("vite" as const)
          : ("framework" as const),
      build_command: p.scripts?.build ? "npm run build" : "",
      output_directory: d.astro || d.vite ? "dist" : "",
    };
  } catch {
    throw new InputError("package.json is not valid JSON");
  }
}
