import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import type { Project } from "../shared/ipc-contract.js";

export function projectForDisk(project: Project, directory: string): Project {
  return {
    ...project,
    assets: project.assets.map((asset) => {
      if (!isAbsolute(asset.path)) return asset;
      const local = relative(resolve(directory), asset.path);
      const external =
        local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local);
      return {
        ...asset,
        path: external ? asset.path : local.split(sep).join("/"),
      };
    }),
  };
}

export function projectFromDisk(project: Project, directory: string): Project {
  return {
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      // Foreign drive paths must stay external so the missing-media UI can relink them.
      path:
        isAbsolute(asset.path) || win32.isAbsolute(asset.path)
          ? asset.path
          : resolve(directory, asset.path),
    })),
  };
}
