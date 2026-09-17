import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (!process.stdin.isTTY) {
  console.error(
    "Run npm run setup:github in your own interactive PowerShell terminal. Never pass secrets as command arguments.",
  );
  process.exit(1);
}
if (!existsSync(".dev.vars")) {
  console.error("Run npm run dev:init first, then run this setup again.");
  process.exit(1);
}
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  console.log(
    "Local GitHub OAuth setup. Secrets are saved only in ignored .dev.vars.",
  );
  const original = readFileSync(".dev.vars", "utf8");
  if (/^GITHUB_CLIENT_(ID|SECRET)=/m.test(original)) {
    const confirm = await rl.question(
      "Replace existing local GitHub OAuth settings? Type yes: ",
    );
    if (confirm !== "yes") process.exit(0);
  }
  const id = (await rl.question("GitHub OAuth Client ID: ")).trim();
  process.stdout.write("GitHub OAuth Client Secret (hidden): ");
  muted = true;
  const secret = (await rl.question("")).trim();
  muted = false;
  process.stdout.write("\n");
  if (
    !/^[a-zA-Z0-9_.-]{5,200}$/.test(id) ||
    !/^[a-zA-Z0-9_.-]{10,300}$/.test(secret)
  )
    throw new Error("Invalid credential format. No changes saved.");
  const retained = original
    .split(/\r?\n/)
    .filter((line) => !/^\s*GITHUB_CLIENT_(ID|SECRET)\s*=/.test(line))
    .join("\n")
    .trimEnd();
  writeFileSync(
    ".dev.vars",
    retained +
      "\nGITHUB_CLIENT_ID=" +
      id +
      "\nGITHUB_CLIENT_SECRET=" +
      secret +
      "\n",
    { mode: 0o600 },
  );
  console.log(
    "Local credentials saved. Restart npm run dev, then press Check GitHub setup in Connections.",
  );
} catch {
  console.error(
    "Setup failed. Check credential format and file permissions. No credentials were printed.",
  );
  process.exitCode = 1;
} finally {
  muted = false;
  rl.close();
}
