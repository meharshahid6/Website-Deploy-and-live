import { test, expect } from "@playwright/test";

test("deployment details and manual domain wizard reflect provider state", async ({
  page,
}, info) => {
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const project = {
    id,
    name: "verified-site",
    framework_type: "static",
    repository_owner: "owner",
    repository_name: "site",
    repository_id: "1",
    production_branch: "main",
    cloudflare_project_name: "verified-site",
    cloudflare_account_id: "account",
    project_status: "live",
    build_command: "",
    output_directory: "",
    last_commit_sha: "a".repeat(40),
    last_commit_message: "Publish site",
    custom_domain: null,
  };
  await page.route("**/api/projects**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = project;
    if (path === "/api/projects") data = [project];
    else if (path.endsWith("/deployments"))
      data = [
        {
          id: "d1",
          provider_deployment_id: "d1",
          status: "successful",
          commit_message: "Publish site",
          commit_sha: "a".repeat(40),
          branch: "main",
          environment: "production",
          started_time: "2026-09-16T00:00:00Z",
          completed_time: "2026-09-16T00:00:20Z",
          preview_url: "https://build.verified-site.pages.dev",
          production_url: "https://verified-site.pages.dev",
        },
      ];
    else if (path.endsWith("/domain"))
      data = {
        name: "example.com",
        apex: "example.com",
        isApex: true,
        zone: { id: "z1", status: "pending" },
        nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
        previous: ["ns1.example.net"],
        records: [],
        delegationActive: false,
        domainStatus: "not-attached",
        sslStatus: "pending",
        liveUrl: null,
      };
    await route.fulfill({ json: { data } });
  });
  await page.goto("/#deployments/" + id);
  await expect(
    page.getByRole("heading", { name: "Follow your launch." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open live website", exact: true }),
  ).toHaveAttribute("href", "https://verified-site.pages.dev");
  await expect(page.getByText(/Duration 20s/)).toBeVisible();
  await page.screenshot({
    path: `artifacts/${info.project.name}-deployments.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Connect domain", exact: true })
    .click();
  await page.getByLabel("Domain or subdomain").fill("example.com");
  await page.getByRole("button", { name: "Check domain", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manual option — one-time setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy amy.ns.cloudflare.com" }),
  ).toBeVisible();
  await expect(
    page.getByText("ns1.example.net", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open live website", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-domains.png`,
    fullPage: true,
  });
});
