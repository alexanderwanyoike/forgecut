import { copyFile, mkdir, writeFile } from "node:fs/promises";
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

export async function integrateAppImage(
  options: MenuOptions,
): Promise<Result<string>> {
  if (options.platform !== "linux" || !options.packaged || !options.appImage)
    return { ok: true, value: "skipped" };
  const dataHome = options.dataHome ?? join(options.home, ".local/share");
  const directory = join(dataHome, "applications");
  const icon = join(dataHome, "icons/forgecut.png");
  await mkdir(directory, { recursive: true });
  await mkdir(join(dataHome, "icons"), { recursive: true });
  await copyFile(options.icon, icon);
  await writeFile(
    join(directory, "forgecut.desktop"),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=ForgeCut",
      "Comment=Lightweight timeline video editor",
      `Exec=env -- "${options.appImage}"`,
      `Icon=${icon}`,
      "Terminal=false",
      "Categories=AudioVideo;Video;",
      "StartupWMClass=forgecut",
      "X-ForgeCut-AppImage-Integration=true",
      "",
    ].join("\n"),
  );
  return { ok: true, value: "registered" };
}
