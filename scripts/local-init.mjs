import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".dev.vars")) {
  console.log(".dev.vars already exists; it was preserved.");
  process.exit(0);
}
writeFileSync(
  ".dev.vars",
  "# Local development only. Never commit or share this file.\nENCRYPTION_KEY=" +
    randomBytes(32).toString("base64") +
    "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created an ignored local encryption key in .dev.vars. No key was printed.",
);
