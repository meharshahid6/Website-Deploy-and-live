import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
test("dashboard, import, Monaco, local preview, draft recovery and connections", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:8787") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ready when you are." }),
  ).toBeVisible();
  await expect(page.getByText("No deployment reported yet")).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("button", { name: "Starter project" }).click();
  await expect(
    page.getByRole("heading", { name: "Review your import" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("smoke-" + info.project.name + "-" + Date.now());
  await page.getByRole("button", { name: "Open in editor" }).click();
  await expect(
    page.getByRole("button", { name: "Publish to GitHub", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page
    .frameLocator('iframe[title="Sandboxed website preview"]')
    .frameLocator('iframe[title="Website content"]');
  await expect(
    preview.getByRole("heading", { name: "Something good starts here." }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Say hello" }).click();
  await expect(
    preview.getByRole("button", { name: "You’re ready to launch!" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  page.once("dialog", (d) => d.accept("about.html"));
  await page.getByRole("button", { name: "Create file", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "about.html", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search across files").fill("body {");
  await expect(page.locator(".file-tree .file")).toHaveCount(1);
  await page.getByLabel("Search across files").fill("");
  await expect(
    page.getByText("Draft saved on this device", { exact: false }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "about.html", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Changes \(/ }).click();
  await expect(page.locator(".changed-list")).toContainText("about.html");
  await page.screenshot({
    path: `artifacts/${info.project.name}-editor.png`,
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByLabel("Deploy immediately after first publish").uncheck();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Publish to GitHub", exact: true })
    .click();
  await expect(page.locator(".alert.error")).toContainText("Connect github");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your tools, connected." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Authorize GitHub" }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/${info.project.name}-connections.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("API fails safely for invalid and cross-origin requests", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/projects", {
        headers: { Origin: "https://untrusted.invalid", "X-LaunchDock": "1" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/projects", {
        headers: { Origin: "http://127.0.0.1:8787", "X-LaunchDock": "1" },
        data: { name: "../invalid" },
      })
    ).status(),
  ).toBe(400);
});

test("ZIP reports blocked secrets, preserves binary data, and rejects traversal", async ({
  page,
}) => {
  await page.goto("/#new");
  const archive = zipSync({
    "index.html": strToU8("<h1>ZIP site</h1>"),
    "image.png": new Uint8Array([137, 80, 78, 71, 0, 255]),
    ".env": strToU8("DO_NOT_PUBLISH=test"),
    "node_modules/test.js": strToU8("ignored"),
  });
  await page
    .getByLabel("Upload zip")
    .setInputFiles({
      name: "site.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
  await expect(
    page.getByText("2 accepted files · 1 ignored · 1 blocked"),
  ).toBeVisible();
  await expect(page.locator(".import-list")).toContainText("image.png");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const unsafe = zipSync({
    "../escape.html": strToU8("bad"),
    "index.html": strToU8("safe"),
  });
  await page
    .getByLabel("Upload zip")
    .setInputFiles({
      name: "unsafe.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(unsafe),
    });
  await expect(page.locator(".alert.error")).toContainText("Unsafe ZIP path");
});

test("preview cannot access parent storage or make network requests", async ({
  page,
}, info) => {
  const outbound: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("blocked.invalid")) outbound.push(r.url());
  });
  await page.goto("/#new");
  const html = `<h1>Isolated</h1><p id="result">Checking</p><script>try{parent.parent.localStorage.setItem('escaped','yes');document.querySelector('#result').textContent='Unsafe'}catch{document.querySelector('#result').textContent='Parent isolated'};fetch('https://blocked.invalid/leak').catch(()=>{});</script>`;
  await page
    .getByLabel("Upload files")
    .setInputFiles({
      name: "index.html",
      mimeType: "text/html",
      buffer: Buffer.from(html),
    });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("isolation-" + info.project.name + "-" + Date.now());
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const frame = page
    .frameLocator('iframe[title="Sandboxed website preview"]')
    .frameLocator('iframe[title="Website content"]');
  await expect(frame.getByText("Parent isolated")).toBeVisible();
  expect(outbound).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("escaped"))).toBeNull();
});
