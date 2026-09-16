import { Unzip, UnzipInflate } from "fflate";
import {
  safePath,
  classifyPath,
  validateFiles,
  LIMITS,
  base64,
} from "../shared/validation";
import type { SourceFile } from "../shared/model";
export interface ImportReport {
  files: SourceFile[];
  items: { path: string; status: string; reason: string }[];
}
export function source(path: string, data: Uint8Array): SourceFile {
  const textExtensions =
    /\.(html?|css|[cm]?jsx?|tsx?|json|md|txt|svg|xml|yml|yaml|toml|csv|webmanifest|map)$/i;
  let content: string;
  try {
    if (
      !textExtensions.test(path) &&
      !["Dockerfile", "_headers", "_redirects", ".gitignore"].includes(
        path.split("/").at(-1)!,
      )
    )
      throw new Error();
    content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (content.includes("\0")) throw new Error();
    return { path, content, encoding: "utf-8" };
  } catch {
    return { path, content: base64(data), encoding: "base64" };
  }
}
export function importZip(data: Uint8Array): ImportReport {
  if (data.length > LIMITS.total)
    throw new Error("ZIP exceeds the 8 MiB compressed limit");
  const report: ImportReport = { files: [], items: [] };
  let total = 0,
    count = 0;
  const seen = new Set<string>();
  const unzip = new Unzip((file) => {
    if (++count > LIMITS.files * 3)
      throw new Error("Archive contains too many entries");
    if (file.name.endsWith("/")) {
      safePath(file.name.slice(0, -1));
      return;
    }
    let path: string;
    try {
      path = safePath(file.name);
    } catch {
      throw new Error(`Unsafe ZIP path: ${file.name}`);
    }
    const classified = classifyPath(path);
    report.items.push({ path, ...classified });
    if (classified.status !== "accepted") return;
    if (seen.has(path.toLowerCase())) throw new Error("Duplicate ZIP paths");
    seen.add(path.toLowerCase());
    if (
      seen.size > LIMITS.files ||
      (file.originalSize !== undefined && file.originalSize > LIMITS.file)
    )
      throw new Error("Archive exceeds file safety limits");
    let size = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      size += chunk.length;
      total += chunk.length;
      if (size > LIMITS.file || total > LIMITS.total) {
        file.terminate();
        throw new Error("ZIP expansion exceeds safety limits");
      }
      chunks.push(chunk);
      if (final) {
        const out = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        report.files.push(source(path, out));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < data.length; i += 4096)
    unzip.push(data.subarray(i, i + 4096), i + 4096 >= data.length);
  validateFiles(report.files);
  return report;
}
export async function importFiles(
  input: FileList | File[],
  folder = false,
): Promise<ImportReport> {
  const report: ImportReport = { files: [], items: [] };
  if (input.length > LIMITS.files * 3)
    throw new Error("Too many selected files");
  let total = 0;
  for (const f of Array.from(input)) {
    const raw = f.webkitRelativePath || f.name;
    let path: string;
    try {
      path = safePath(folder ? raw.split("/").slice(1).join("/") : raw);
    } catch {
      report.items.push({
        path: raw,
        status: "blocked",
        reason: "Unsafe file path",
      });
      continue;
    }
    const c = classifyPath(path);
    report.items.push({ path, ...c });
    if (c.status !== "accepted") continue;
    total += f.size;
    if (f.size > LIMITS.file || total > LIMITS.total)
      throw new Error("Use at most 500 files, 2 MiB per file and 8 MiB total");
    report.files.push(source(path, new Uint8Array(await f.arrayBuffer())));
  }
  validateFiles(report.files);
  return report;
}
export const starter: SourceFile[] = [
  {
    path: "index.html",
    encoding: "utf-8",
    content:
      '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My new website</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <p class="eyebrow">HELLO, WORLD</p>\n    <h1>Something good starts here.</h1>\n    <p>Built with curiosity. Shipped with LaunchDock.</p>\n    <button onclick="this.textContent=\'You’re ready to launch!\'">Say hello</button>\n  </main>\n</body>\n</html>',
  },
  {
    path: "style.css",
    encoding: "utf-8",
    content:
      "body { margin: 0; background: #f4f6fa; color: #182239; font: 18px/1.6 system-ui; }\nmain { max-width: 720px; padding: 12vh 8vw; }\nh1 { font-size: clamp(40px, 7vw, 76px); line-height: 1.08; letter-spacing: -3px; }\n.eyebrow { color: #366fe8; font-size: 12px; letter-spacing: 3px; }\nbutton { background: #366fe8; border: 0; color: white; padding: 14px 22px; border-radius: 8px; cursor: pointer; }",
  },
];
