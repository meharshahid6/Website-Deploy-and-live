import type { SourceFile } from "../shared/model";
import { bytes, base64 } from "../shared/validation";

export function previewHTML(files: SourceFile[], entry = "index.html") {
  const html = files.find((f) => f.path === entry && f.encoding === "utf-8");
  if (!html) return "<p>Choose an HTML entry file to preview.</p>";
  const doc = new DOMParser().parseFromString(html.content, "text/html");
  doc
    .querySelectorAll("base,meta[http-equiv],iframe,object,embed")
    .forEach((n) => n.remove());

  const lookup = (url: string, from: string) => {
    if (!url || /^(https?:|\/\/|data:|blob:)/i.test(url)) return;
    try {
      const u = new URL(url, "https://preview.invalid/" + from);
      if (u.origin !== "https://preview.invalid") return;
      const target = decodeURIComponent(u.pathname.slice(1));
      const exact = files.find((f) => f.path === target);
      if (exact) return exact;
      const lower = files.find(
        (f) => f.path.toLowerCase() === target.toLowerCase(),
      );
      if (lower) return lower;
      const clean = target.replace(/^\.?\//, "");
      const cleanMatch = files.find(
        (f) =>
          f.path === clean || f.path.toLowerCase() === clean.toLowerCase(),
      );
      if (cleanMatch) return cleanMatch;
      const baseName = clean.split("/").pop();
      if (baseName) {
        return files.find(
          (f) =>
            f.path.endsWith("/" + baseName) ||
            f.path.toLowerCase().endsWith("/" + baseName.toLowerCase()),
        );
      }
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
      woff: "font/woff",
      ttf: "font/ttf",
      mp4: "video/mp4",
      webm: "video/webm",
    })[p.split(".").at(-1)!.toLowerCase()] ?? "application/octet-stream";

  const data = (f: SourceFile) =>
    `data:${mime(f.path)};base64,${base64(bytes(f))}`;

  const css = (text: string, from: string) =>
    text.replace(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g, (orig, url: string) => {
      if (/^(https?:|\/\/|data:)/i.test(url.trim())) return orig;
      const f = lookup(url.trim(), from);
      return f ? `url("${data(f)}")` : 'url("")';
    });

  // Preserve external stylesheets (Google Fonts, Tailwind CDN, etc.) and inline local ones
  doc
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    .forEach((el) => {
      const href = el.getAttribute("href") ?? "";
      if (/^(https?:|\/\/)/i.test(href)) {
        return;
      }
      const f = lookup(href, entry);
      if (f?.encoding === "utf-8") {
        const style = doc.createElement("style");
        style.textContent = css(f.content, f.path);
        el.replaceWith(style);
      } else if (f) {
        el.setAttribute("href", data(f));
      } else {
        el.remove();
      }
    });

  doc.querySelectorAll("style").forEach((el) => {
    el.textContent = css(el.textContent ?? "", entry);
  });

  // Handle scripts: preserve external scripts (e.g. Tailwind CDN) and inline local scripts
  doc.querySelectorAll<HTMLScriptElement>("script[src]").forEach((el) => {
    const src = el.getAttribute("src") ?? "";
    if (/^(https?:|\/\/|data:|blob:)/i.test(src)) {
      return;
    }
    const f = lookup(src, entry);
    if (f) {
      el.setAttribute("src", data(f));
    } else {
      el.removeAttribute("src");
    }
  });

  // Handle images, media and other resources
  doc.querySelectorAll<HTMLElement>("[src],[poster]").forEach((el) => {
    if (el.tagName.toLowerCase() === "script") return;
    for (const attr of ["src", "poster"]) {
      const url = el.getAttribute(attr);
      if (!url) continue;
      if (/^(https?:|\/\/|data:|blob:)/i.test(url)) {
        continue;
      }
      const f = lookup(url, entry);
      if (f) el.setAttribute(attr, data(f));
      else el.removeAttribute(attr);
    }
  });

  doc.querySelectorAll("a").forEach((el) => {
    el.removeAttribute("href");
    el.title = "Navigation is disabled in local preview";
  });

  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:; style-src 'unsafe-inline' https: data:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src https:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.insertBefore(csp, doc.head.firstChild);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
