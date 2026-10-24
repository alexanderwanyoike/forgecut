import type {
  GraphicResource,
  GraphicResourceImport,
  GraphicResourceSelection,
} from "../shared/graphic-resources.js";
import type { EditingService } from "./editing-service.js";
import { sourceFrame } from "./source-frame.js";

type MediaJobRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
} & (
  | { action: "import"; paths: string[] }
  | { action: "frame"; assetId: string; timeUs: number }
  | {
      action: "resource";
      resource: GraphicResourceImport & { target?: GraphicResourceSelection };
    }
);

export function startMediaJob(
  service: EditingService,
  request: MediaJobRequest,
) {
  const { state } = service;
  state.assertSession(request.sessionId);
  return service.jobs.start(
    {
      sessionId: request.sessionId,
      projectRevision: request.expectedRevision,
      requestId: request.requestId,
      kind: request.action === "resource" ? "import" : request.action,
      label: {
        frame: "Source frame",
        import: "Import media",
        resource: "Import graphic resource",
      }[request.action],
      input: request,
    },
    async (signal, onProgress, beginCommit) => {
      if (state.sessionId !== request.sessionId)
        return {
          ok: false,
          error: {
            code: "PROJECT_CHANGED",
            message: "The project changed before the media job started.",
          },
        };
      if (state.revision !== request.expectedRevision)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message:
              "The project changed before the media job started. Read it again and retry.",
          },
        };
      if (request.action === "frame") {
        const asset = state.project.assets.find(
          (candidate) => candidate.id === request.assetId,
        );
        if (!asset)
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "Source asset not found.",
            },
          };
        return sourceFrame(asset, request.timeUs, signal);
      }
      const imported = await service.execute(
        request.action === "resource"
          ? "import_graphic_resource"
          : "import_assets",
        request.action === "resource"
          ? {
              ...request.resource,
              target: request.resource.target
                ? {
                    ...request.resource.target,
                    sessionId: request.sessionId,
                    expectedRevision: request.expectedRevision,
                  }
                : undefined,
            }
          : { paths: request.paths },
        { sessionId: request.sessionId },
        { signal, onProgress, beginCommit },
      );
      if (!imported.ok) return imported;
      if (request.action === "resource")
        return {
          ok: true,
          value: {
            resourceId: (imported.value as GraphicResource).id,
            sha256: (imported.value as GraphicResource).sha256,
          },
        };
      return {
        ok: true,
        value: {
          assetIds: (imported.value as { id: string }[]).map(
            (asset) => asset.id,
          ),
        },
      };
    },
  );
}
