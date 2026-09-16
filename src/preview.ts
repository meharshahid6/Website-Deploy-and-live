import type { SourceFile } from "../shared/model";
import { bytes, base64 } from "../shared/validation";
// No origin permission, network, forms, popups, top navigation or parent APIs.
// Assets are data URLs generated locally; external resources are blocked.
export function previewHTML(files: SourceFile[], entry = "index.html") {
  const html = files.find((f) => f.path === entry && f.encoding === "utf-8");
  if (!html) return "<p>Choose an HTML entry file to preview.</p>";
  const doc = new DOMParser().parseFromString(html.content, "text/html");
  doc
    .querySelectorAll("base,meta[http-equiv],iframe,object,embed")
    .forEach((n) => n.remove());
  const lookup = (url: string, from: string) => {
    try {
      const u = new URL(url, "https://preview.invalid/" + from);
      if (u.origin !== "https://preview.invalid") return;
      return files.find(
        (f) => f.path === decodeURIComponent(u.pathname.slice(1)),
      );
    } catch {
      return;
    }
  };
  const mime = (p: string) =>
    ({
      css: "text/css",
      js: "text/javascript",
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      ico: "image/x-icon",
      woff2: "font/woff2",
    })[p.split(".").at(-1)!] ?? "application/octet-stream";
  const data = (f: SourceFile) =>
    `data:${mime(f.path)};base64,${base64(bytes(f))}`;
  const css = (text: string, from: string) =>
    text
      .replace(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g, (_, url: string) => {
        const f = lookup(url, from);
        return f ? `url("${data(f)}")` : 'url("")';
      })
      .replace(/@import[^;]+;/g, "");
  doc
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    .forEach((el) => {
      const f = lookup(el.getAttribute("href") ?? "", entry);
      if (f?.encoding === "utf-8") {
        const style = doc.createElement("style");
        style.textContent = css(f.content, f.path);
        el.replaceWith(style);
      } else el.remove();
    });
  doc.querySelectorAll("style").forEach((el) => {
    el.textContent = css(el.textContent ?? "", entry);
  });
  doc.querySelectorAll<HTMLElement>("[src],[poster]").forEach((el) => {
    for (const attr of ["src", "poster"]) {
      const url = el.getAttribute(attr);
      if (!url) continue;
      const f = lookup(url, entry);
      if (f) el.setAttribute(attr, data(f));
      else el.removeAttribute(attr);
    }
  });
  doc
    .querySelectorAll("[srcset]")
    .forEach((el) => el.removeAttribute("srcset"));
  doc.querySelectorAll("a").forEach((el) => {
    el.removeAttribute("href");
    el.title = "Navigation is disabled in local preview";
  });
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.insertBefore(csp, doc.head.firstChild);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
