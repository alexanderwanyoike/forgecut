import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const name =
  process.argv[2] ??
  join(
    "dist-installers",
    (await readdir("dist-installers")).find((file) =>
      file.endsWith(".AppImage"),
    ) ?? "missing.AppImage",
  );
const image = resolve(name);
const directory = await mkdtemp(join(tmpdir(), "forgecut-menu-native-"));
const dataHome = join(directory, "data");
const entry = join(dataHome, "applications/forgecut.desktop");
const environment = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: undefined,
  APPIMAGE_EXTRACT_AND_RUN: "1",
  XDG_DATA_HOME: dataHome,
  FORGECUT_MCP_DIR: join(directory, "mcp"),
  FORGECUT_RESOURCE_DIR: join(directory, "resources"),
  FORGECUT_DRAFT_DIR: join(directory, "drafts"),
};
const player = spawn(
  image,
  ["--no-sandbox", `--user-data-dir=${join(directory, "profile")}`],
  { env: environment, stdio: "ignore", detached: true },
);
try {
  let text = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    text = await readFile(entry, "utf8").catch(() => "");
    if (text.includes("X-ForgeCut-AppImage-Integration=true")) break;
    assert.equal(player.exitCode, null, "AppImage exited before registration");
    await delay(100);
  }
  assert(
    text.includes("X-ForgeCut-AppImage-Integration=true"),
    "First AppImage launch did not add ForgeCut to the application menu",
  );
  const run = promisify(execFile);
  await run("desktop-file-validate", [entry]);
  await run(
    "/usr/bin/python3",
    [
      "-c",
      [
        "from gi.repository import Gio",
        "import os, shlex, sys",
        "app = Gio.DesktopAppInfo.new('forgecut.desktop')",
        "assert app is not None, 'ForgeCut is missing from menu discovery'",
        "assert app.get_name() == 'ForgeCut'",
        "assert app.get_startup_wm_class() == 'forgecut'",
        "assert shlex.split(app.get_commandline()) == ['env', '--', sys.argv[1]]",
        "assert os.path.isfile(app.get_icon().get_file().get_path())",
      ].join("\n"),
      image,
    ],
    { env: environment },
  );
  let windows = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    windows = (await run("xwininfo", ["-root", "-tree"])).stdout;
    if (/"ForgeCut": \("forgecut" "forgecut"\)/.test(windows)) break;
    await delay(100);
  }
  assert.match(
    windows,
    /"ForgeCut": \("forgecut" "forgecut"\)/,
    "Window identity does not match the launcher",
  );
  assert.deepEqual(await readdir(join(dataHome, "applications")), [
    "forgecut.desktop",
  ]);
  console.log(
    "Packaged AppImage first launch: menu discovery, stable executable, icon and window identity verified",
  );
} finally {
  const closed = new Promise((resolve) => player.once("close", resolve));
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-player.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    if (signal === "SIGTERM") await Promise.race([closed, delay(2000)]);
  }
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
