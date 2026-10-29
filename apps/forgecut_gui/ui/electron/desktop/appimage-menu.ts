import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../shared/result.js";

interface MenuOptions {
  platform: NodeJS.Platform;
  packaged: boolean;
  appImage?: string;
  dataHome?: string;
  home: string;
  icon: string;
}

function quoteExecutable(value: string): string {
  const quoted = value.replace(/[\\"`$]/g, (character) => `\\${character}`);
  // Desktop string escapes are decoded before Exec argument quoting.
  return `"${quoted.replaceAll("\\", "\\\\").replaceAll("%", "%%")}"`;
}

export async function integrateAppImage(
  options: MenuOptions,
): Promise<Result<string>> {
  if (options.platform !== "linux" || !options.packaged || !options.appImage)
    return { ok: true, value: "skipped" };
  const dataHome = options.dataHome ?? join(options.home, ".local/share");
  const directory = join(dataHome, "applications");
  const icon = join(dataHome, "icons/forgecut.png");
  const entry = join(directory, "forgecut.desktop");
  const temporary = `${entry}.${randomUUID()}.tmp`;
  try {
    let existing: string | undefined;
    try {
      existing = await readFile(entry, "utf8");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (
      existing !== undefined &&
      !existing.split("\n").includes("X-ForgeCut-AppImage-Integration=true")
    )
      return { ok: true, value: "existing" };
    await mkdir(directory, { recursive: true });
    await mkdir(join(dataHome, "icons"), { recursive: true });
    await copyFile(options.icon, icon);
    await writeFile(
      temporary,
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=ForgeCut",
        "Comment=Lightweight timeline video editor",
        `Exec=env -- ${quoteExecutable(options.appImage)}`,
        `Icon=${icon}`,
        "Terminal=false",
        "Categories=AudioVideo;Video;",
        "StartupWMClass=forgecut",
        "X-ForgeCut-AppImage-Integration=true",
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o644 },
    );
    if (existing !== undefined) await rename(temporary, entry);
    else {
      try {
        await link(temporary, entry);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
          return { ok: true, value: "existing" };
        throw error;
      }
    }
    return { ok: true, value: "registered" };
  } catch {
    return {
      ok: false,
      error: {
        code: "MENU_REGISTRATION_FAILED",
        message:
          "ForgeCut could not add its application-menu shortcut. You can still open its AppImage directly.",
      },
    };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
