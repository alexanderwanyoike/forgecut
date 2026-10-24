import type { GraphicDraft } from "../shared/graphic-draft.js";
import type { EditingService } from "../backend/editing-service.js";
import { EditingError } from "../backend/editing-error.js";
import { resolveGraphicInstance } from "../domain/graphic-instance.js";
import type { BridgeResult } from "./contract.js";
import type { SourceAction } from "./draft-schema.js";

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
  if (request.action === "source-read") {
    const component =
      request.view === "active" ? active.value.component : draft.component;
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
        sessionId: state.sessionId,
        revision: state.revision,
        itemId: request.itemId,
        componentId: component.id,
        activeVersion: active.value.component.version,
        baseVersion: draft.baseVersion,
        draftRevision: draft.revision,
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
