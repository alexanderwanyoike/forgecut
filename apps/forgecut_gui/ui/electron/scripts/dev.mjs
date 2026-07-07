import electronPath from "electron";
import { spawn } from "node:child_process";

const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173";
const children = [];

function spawnChecked(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });
  return child;
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url) {
  for (let i = 0; i < 100; i += 1) {
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

if (!(await isReachable(rendererUrl))) {
  spawnChecked("yarn", ["dev:web"]);
}

await waitForUrl(rendererUrl);

const build = spawn("yarn", ["build:electron"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
const buildCode = await new Promise((resolve) => build.on("exit", resolve));
if (buildCode !== 0) {
  shutdown(Number(buildCode) || 1);
}

const electron = spawnChecked(electronPath, ["electron/dist/main.js"], {
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: rendererUrl,
    ELECTRON_REMOTE_DEBUGGING_PORT:
      process.env.ELECTRON_REMOTE_DEBUGGING_PORT ?? "9222",
  },
});

electron.on("exit", (code) => shutdown(Number(code) || 0));
