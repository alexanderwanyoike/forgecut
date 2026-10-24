import type { EditingService } from "./editing-service.js";
import { sourceFrame } from "./source-frame.js";

type MediaJobRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
} & (
  | { action: "import"; paths: string[] }
  | { action: "frame"; assetId: string; timeUs: number }
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
      kind: request.action,
      label: request.action === "import" ? "Import media" : "Source frame",
      input: request,
    },
    async (signal, onProgress) => {
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
        "import_assets",
        { paths: request.paths },
        { sessionId: request.sessionId },
        { signal, onProgress },
      );
      if (!imported.ok) return imported;
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
