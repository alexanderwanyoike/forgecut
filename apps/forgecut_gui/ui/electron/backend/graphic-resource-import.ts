import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { inspectGraphicResource } from "./graphic-resource-format.js";
import { EditingError } from "./editing-error.js";
import type {
  GraphicResource,
  ResourceLicense,
} from "../shared/graphic-resources.js";
import type { Result } from "../shared/result.js";
import {
  readResourceFile,
  resourceHash,
  storeResource,
} from "./graphic-resource-store.js";

export async function importGraphicResource(
  path: string,
  kind: GraphicResource["kind"],
  license: ResourceLicense,
  signal?: AbortSignal,
): Promise<Result<GraphicResource>> {
  try {
    const bytes = await readResourceFile(path, signal);
    const inspected = inspectGraphicResource(bytes, kind);
    if (!inspected.ok) return inspected;
    const sha256 = resourceHash(bytes);
    await storeResource(bytes, sha256);
    return {
      ok: true,
      value: {
        id: randomUUID(),
        name: basename(path),
        kind,
        ...inspected.value,
        sha256,
        path: `.forgecut-resources/${sha256}`,
        license,
      },
    };
  } catch (failure) {
    return {
      ok: false,
      error: {
        code: failure instanceof EditingError ? failure.code : "IO_ERROR",
        message: failure instanceof Error ? failure.message : String(failure),
      },
    };
  }
}
