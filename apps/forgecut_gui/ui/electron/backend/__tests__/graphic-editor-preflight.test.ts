/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { GraphicPreviewService } from "../GraphicPreviewService";
import type { GraphicDraft } from "../../shared/graphic-draft";
it("returns prepared package declarations without host Node or duplicate standard libraries", async () => {
  const service = new EditingService(new AppState());
  const result = await service.execute("get_graphic_type_libraries");
  expect(result, JSON.stringify(result).slice(0, 300)).toMatchObject({
    ok: true,
  });
  if (!result.ok) throw new Error(result.error.message);
  const libraries = result.value as Record<string, string>;
  expect(libraries["/forgecut/node_modules/@types/react/index.d.ts"]).toContain(
    "React",
  );
  expect(libraries["/forgecut/node_modules/remotion/package.json"]).toContain(
    '"4.0.537"',
  );
  expect(
    Object.keys(libraries).every(
      (path) =>
        path.startsWith("/forgecut/node_modules/") &&
        !path.includes("@types/node/"),
    ),
  ).toBe(true);
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
it("previews a recoverable draft separately and rejects a changed project before returning its frame", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-editor-preflight-"));
  vi.stubEnv("FORGECUT_DRAFT_DIR", directory);
  const state = new AppState();
  const service = new EditingService(state);
  const renderer = vi
    .spyOn(GraphicPreviewService.prototype, "render")
    .mockResolvedValue({
      ok: true,
      value: { mimeType: "image/png", data: "AA==", width: 64, height: 36 },
    });
  try {
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { title: "Active title" },
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    const itemId = item.RemotionGraphic.id;
    const result = await service.execute("get_graphic_draft", { itemId });
    if (!result.ok) throw new Error(result.error.message);
    const draft = result.value as GraphicDraft;
    draft.component.source.files[draft.component.source.entry] +=
      "\n// draft preview";
    await service.execute("save_graphic_draft", {
      itemId,
      sessionId: state.sessionId,
      expectedDraftRevision: 0,
      baseVersion: draft.baseVersion,
      component: draft.component,
    });
    const before = state.snapshot();
    const input = {
      itemId,
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      expectedDraftRevision: 1,
      frame: 0,
    };
    expect(
      await service.execute("get_graphic_draft_preview", input),
    ).toMatchObject({
      ok: true,
      value: { mimeType: "image/png", data: "AA==" },
    });
    expect(state.snapshot()).toEqual(before);
    const candidate = renderer.mock.calls[0][0];
    expect(
      candidate.components?.some((component) =>
        component.source.files[component.source.entry].endsWith(
          "// draft preview",
        ),
      ),
    ).toBe(true);
    renderer.mockImplementationOnce(async () => {
      await service.execute("update_item", {
        itemId,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { title: "Manual edit" } },
        },
      });
      return {
        ok: true,
        value: { mimeType: "image/png", data: "AA==", width: 64, height: 36 },
      };
    });
    expect(
      await service.execute("get_graphic_draft_preview", input),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
