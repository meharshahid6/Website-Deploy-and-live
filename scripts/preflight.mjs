import fs from "node:fs";
import { parse } from "jsonc-parser";
const errors = [];
const c = parse(fs.readFileSync("wrangler.jsonc", "utf8"), errors, {
  allowTrailingComma: true,
});
if (errors.length) {
  console.error(
    "wrangler.jsonc is not valid JSONC. Fix the configuration before deployment.",
  );
  process.exit(1);
}
const failures = [];
if (c.d1_databases[0].database_id === "00000000-0000-0000-0000-000000000000")
  failures.push("Create the free D1 database and set its database_id.");
if (!c.vars.APP_ORIGIN.startsWith("https://"))
  failures.push("Set APP_ORIGIN to the production HTTPS dashboard origin.");
if (
  !c.vars.ACCESS_TEAM_DOMAIN.endsWith(".cloudflareaccess.com") ||
  !c.vars.ACCESS_AUD ||
  !c.vars.OWNER_EMAIL
)
  failures.push(
    "Configure Access team domain, application audience and owner email.",
  );
if (c.vars.LOCAL_DEV !== "false")
  failures.push("LOCAL_DEV must be false in production.");
if (failures.length) {
  console.error(
    "Deployment preparation required:\n" +
      failures.map((x) => " - " + x).join("\n"),
  );
  process.exit(1);
}
console.log(
  "Configuration passed. Ensure Worker secrets exist and Access covers the exact hostname before deployment.",
);
