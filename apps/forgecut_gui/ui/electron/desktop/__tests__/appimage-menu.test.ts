// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { integrateAppImage } from "../appimage-menu";

const run = promisify(execFile);
test.skipIf(process.platform !== "linux")(
  "registers a discoverable launcher with a durable icon that starts the outer AppImage",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-menu-"));
    try {
      const appImage = join(
        directory,
        'ForgeCut "mix" $cash `test` 100%\\.AppImage',
      );
      const marker = join(directory, "launched");
      await writeFile(appImage, `#!/bin/sh\nprintf '%s' "$0" > "${marker}"\n`, {
        mode: 0o755,
      });
      const dataHome = join(directory, "user data");
      const icon = resolve("electron/assets/icon.png");
      expect(
        await integrateAppImage({
          platform: "linux",
          packaged: true,
          appImage,
          dataHome,
          home: directory,
          icon,
        }),
      ).toEqual({ ok: true, value: "registered" });
      await run(
        "/usr/bin/python3",
        [
          "-c",
          [
            "from gi.repository import Gio",
            "import os",
            "app = Gio.DesktopAppInfo.new('forgecut.desktop')",
            "assert app is not None, 'ForgeCut is missing from application discovery'",
            "assert app.get_name() == 'ForgeCut'",
            "assert app.get_startup_wm_class() == 'forgecut'",
            "assert 'Video' in app.get_categories()",
            "assert os.path.isfile(app.get_icon().get_file().get_path())",
            "assert app.launch([], None)",
          ].join("\n"),
        ],
        { env: { ...process.env, XDG_DATA_HOME: dataHome } },
      );
      await expect
        .poll(() => readFile(marker, "utf8").catch(() => ""))
        .toBe(appImage);
      expect(await readFile(join(dataHome, "icons/forgecut.png"))).toEqual(
        await readFile(icon),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("leaves development, package installations and other platforms untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-menu-skip-"));
  try {
    const options = {
      platform: "linux" as const,
      packaged: true,
      appImage: "/unused.AppImage",
      home: directory,
      icon: "/unused",
    };
    for (const override of [
      { packaged: false },
      { platform: "win32" as const },
      { platform: "darwin" as const },
      { appImage: undefined },
    ]) {
      expect(await integrateAppImage({ ...options, ...override })).toEqual({
        ok: true,
        value: "skipped",
      });
    }
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")(
  "reports unavailable menu storage without rejecting startup",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-menu-error-"));
    try {
      const dataHome = join(directory, "data");
      await writeFile(dataHome, "keep this file");
      const result = await integrateAppImage({
        platform: "linux",
        packaged: true,
        appImage: process.execPath,
        dataHome,
        home: directory,
        icon: resolve("electron/assets/icon.png"),
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "MENU_REGISTRATION_FAILED" },
      });
      expect(await readFile(dataHome, "utf8")).toBe("keep this file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
