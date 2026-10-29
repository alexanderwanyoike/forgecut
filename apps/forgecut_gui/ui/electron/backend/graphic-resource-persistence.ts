import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GraphicResource } from "../shared/graphic-resources.js";
import { inspectGraphicResource } from "./graphic-resource-format.js";
import { atomicWrite } from "./atomic-file.js";
import {
  readGraphicResource,
  readResourceFile,
  storeResource,
} from "./graphic-resource-store.js";

export async function saveGraphicResources(
  resources: GraphicResource[],
  directory: string,
): Promise<void> {
  if (resources.length === 0) return;
  await mkdir(join(directory, ".forgecut-resources"), {
    recursive: true,
    mode: 0o700,
  });
  for (const resource of resources) {
    const read = await readGraphicResource(resource);
    if (!read.ok) throw new Error(read.error.message);
    await atomicWrite(join(directory, resource.path), read.value);
  }
}
export async function loadGraphicResources(
  resources: GraphicResource[],
  directory: string,
): Promise<void> {
  for (const resource of resources) {
    try {
      const bytes = await readResourceFile(join(directory, resource.path));
      const inspected = inspectGraphicResource(bytes, resource.kind);
      if (!inspected.ok) throw new Error(inspected.error.message);
      if (inspected.value.mime !== resource.mime)
        throw new Error("Resource media type does not match its content");
      await storeResource(bytes, resource.sha256);
    } catch (failure) {
      throw new Error(
        `Graphic resource unavailable: ${resource.name}. ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  }
}
