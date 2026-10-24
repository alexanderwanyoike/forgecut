import type { GraphicComponent } from "../shared/graphics.js";
import type { GraphicDraft } from "../shared/graphic-draft.js";
import type { EditingService } from "../backend/editing-service.js";
import { EditingError } from "../backend/editing-error.js";
import { resolveGraphicInstance } from "../domain/graphic-instance.js";
import type { BridgeResult } from "./contract.js";
import type { SourceAction } from "./draft-schema.js";

function sourceView(
  component: GraphicComponent,
  request: Extract<SourceAction, { action: "source-read" }>,
  version: {
    revision: number;
    activeVersion: string;
    baseVersion: string;
    draftRevision: number | null;
  },
): BridgeResult {
  const { source: sourceFiles, ...metadata } = component;
  const content = request.file ? sourceFiles.files[request.file] : undefined;
  if (request.file && content === undefined)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Source file not found" },
    };
  return {
    ok: true,
    value: {
      sessionId: request.sessionId,
      revision: version.revision,
      itemId: request.itemId,
      componentId: component.id,
      activeVersion: version.activeVersion,
      baseVersion: version.baseVersion,
      draftRevision: version.draftRevision,
      entry: sourceFiles.entry,
      ...(request.includeMetadata ? { metadata } : {}),
      files: Object.entries(sourceFiles.files).map(([path, text]) => ({
        path,
        bytes: Buffer.byteLength(text),
      })),
      ...(request.file ? { file: { path: request.file, content } } : {}),
    },
  };
}

export async function dispatchGraphicSource(
  service: EditingService,
  request: SourceAction,
): Promise<BridgeResult> {
  const { state } = service;
  state.assertSession(request.sessionId);
  const { action, ...input } = request;
  if (action === "source-promote") {
    const result = await service.execute("start_graphic_promotion", input);
    return result.ok ? { ok: true, value: result.value } : result;
  }
  if (action === "draft-save" || action === "draft-revert") {
    const saved = await service.execute(
      action === "draft-save" ? "save_graphic_draft" : "revert_graphic_draft",
      input,
    );
    if (!saved.ok) return saved;
    const draft = saved.value as GraphicDraft;
    return {
      ok: true,
      value: {
        draftRevision: draft.revision,
        baseVersion: draft.baseVersion,
        componentId: draft.component.id,
      },
    };
  }
  const active = resolveGraphicInstance(state.project, request.itemId);
  if (!active.ok) return active;
  if (request.action === "source-read" && request.view === "active")
    return sourceView(active.value.component, request, {
      revision: state.revision,
      activeVersion: active.value.component.version,
      baseVersion: active.value.component.version,
      draftRevision: null,
    });
  const loaded = await service.execute(
    "get_graphic_draft",
    { itemId: request.itemId },
    { sessionId: request.sessionId },
  );
  if (!loaded.ok) return loaded;
  state.assertSession(request.sessionId);
  if (loaded.revision !== state.revision)
    throw new EditingError("CONFLICT", "Project changed while reading source");
  const draft = loaded.value as GraphicDraft;
  if (request.action === "source-read")
    return sourceView(draft.component, request, {
      revision: state.revision,
      activeVersion: active.value.component.version,
      baseVersion: draft.baseVersion,
      draftRevision: draft.revision,
    });
  if (request.expectedDraftRevision !== draft.revision)
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "The draft changed. Read its latest revision before patching source.",
      },
    };
  if (request.remove && request.content !== undefined)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Choose file content or removal",
      },
    };
  if (!request.remove && request.content === undefined)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Provide source content or request removal",
      },
    };
  const component = structuredClone(draft.component);
  if (request.remove) delete component.source.files[request.path];
  else
    component.source.files = {
      ...component.source.files,
      [request.path]: request.content ?? "",
    };
  const saved = await service.execute("save_graphic_draft", {
    itemId: request.itemId,
    sessionId: request.sessionId,
    expectedDraftRevision: request.expectedDraftRevision,
    baseVersion: request.baseVersion,
    component,
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    value: {
      draftRevision: (saved.value as GraphicDraft).revision,
      baseVersion: request.baseVersion,
    },
  };
}
