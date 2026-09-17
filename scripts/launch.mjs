import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const origin = "http://127.0.0.1:5173";
const state = path.join(root, ".wrangler/launcher-status.json");
async function ready() {
  try {
    const r = await fetch(origin + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    return (await r.json()).data?.name === "LaunchDock";
  } catch {
    return false;
  }
}
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      "Local setup failed. Run npm run check from the project folder for diagnostics.",
    );
}
function status(message) {
  writeFileSync(state, JSON.stringify({ message }));
}
if (process.argv.includes("--serve")) {
  mkdirSync(path.dirname(state), { recursive: true });
  try {
    status("Preparing LaunchDock");
    run("scripts/local-init.mjs");
    run("node_modules/vite/bin/vite.js", ["build"]);
    run("node_modules/wrangler/bin/wrangler.js", [
      "d1",
      "migrations",
      "apply",
      "launchdock",
      "--local",
    ]);
    status("Starting local server");
    const child = spawn(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "dev",
        "--ip",
        "127.0.0.1",
        "--port",
        "5173",
        "--log-level",
        "error",
        "--var",
        "LOCAL_DEV:true",
        "--var",
        `APP_ORIGIN:${origin}`,
      ],
      {
        cwd: root,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    child.on("error", () =>
      status("Could not start the local server. Check Node.js installation."),
    );
    child.on("exit", () =>
      status(
        "Local server stopped. Double-click LaunchDock.cmd to start again.",
      ),
    );
  } catch (e) {
    status(e.message);
    process.exitCode = 1;
  }
} else {
  if (!existsSync("node_modules/wrangler/bin/wrangler.js")) {
    console.error(
      "Dependencies are missing. Open this project folder in a terminal and run npm ci once.",
    );
    process.exit(1);
  }
  if (!(await ready())) {
    mkdirSync(path.dirname(state), { recursive: true });
    status("Preparing LaunchDock");
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--serve"],
      { cwd: root, detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
    console.log(
      "LaunchDock is starting. This window will close when your browser opens.",
    );
    let started = false;
    for (let i = 0; i < 120; i++) {
      if (await ready()) {
        started = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!started) {
      console.error(JSON.parse(readFileSync(state, "utf8")).message);
      console.error(
        "Could not open LaunchDock. Check whether port 5173 is already in use.",
      );
      process.exit(1);
    }
  }
  spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Start-Process '${origin}/#connections'`,
    ],
    { stdio: "ignore", windowsHide: true },
  ).unref();
}
