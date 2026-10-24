/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { GraphicDraft } from "../../shared/graphic-draft";
import type { JobSnapshot } from "../../shared/jobs";
const available =
  process.env.FORGECUT_GRAPHICS_TEST === "1" &&
  process.platform === "linux" &&
  spawnSync("systemctl", ["--user", "is-active", "--quiet", "default.target"])
    .status === 0;
it.skipIf(!available)(
  "promotes checked source, retains working source on syntax/runtime failures, and reopens visual edits",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "forgecut-promotion-runtime-"),
    );
    vi.stubEnv("FORGECUT_DRAFT_DIR", join(directory, "drafts"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      expect(
        await service.execute("add_graphic_item", {
          templateId: "title-card",
          trackId: "graphics",
          timelineStartUs: 0,
          durationUs: 1000000,
          props: { title: "", color: "#00ff00" },
        }),
      ).toMatchObject({ ok: true });
      const item = state.project.timeline.tracks[0].items[0];
      if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
      const itemId = item.RemotionGraphic.id;
      const draft = await service.execute("get_graphic_draft", { itemId });
      if (!draft.ok) throw new Error(draft.error.message);
      const initial = draft.value as GraphicDraft;
      async function apply(code: string) {
        const current = await service.execute("get_graphic_draft", { itemId });
        if (!current.ok) throw new Error(current.error.message);
        const previous = current.value as GraphicDraft;
        const component = structuredClone(initial.component);
        component.source.files[component.source.entry] = code;
        const active = state.project.timeline.tracks[0].items[0];
        if (!("RemotionGraphic" in active)) throw new Error("Missing graphic");
        expect(
          await service.execute("save_graphic_draft", {
            itemId,
            sessionId: state.sessionId,
            expectedDraftRevision: previous.revision,
            baseVersion: active.RemotionGraphic.component_version,
            component,
          }),
        ).toMatchObject({ ok: true });
        const started = await service.execute("start_graphic_promotion", {
          itemId,
          sessionId: state.sessionId,
          expectedRevision: state.revision,
          expectedDraftRevision: previous.revision + 1,
          requestId: randomUUID(),
        });
        if (!started.ok) throw new Error(started.error.message);
        const job = started.value as JobSnapshot;
        let result: JobSnapshot | undefined;
        await vi.waitFor(
          () => {
            const read = service.jobs.read(job.id, job.sessionId);
            if (!read.ok) throw new Error(read.error.message);
            expect(["completed", "failed", "cancelled"]).toContain(
              read.value.status,
            );
            result = read.value;
          },
          { timeout: 30000, interval: 25 },
        );
        return result!.result;
      }
      expect(
        await apply(
          'export default function Card({values}:ForgeCut.Props){return <div style={{position:"absolute",inset:0,backgroundColor:values.color}}/>}',
        ),
      ).toMatchObject({ ok: true });
      const approved = state.snapshot();
      expect(await apply("export default function Broken( {")).toMatchObject({
        ok: false,
      });
      expect(state.snapshot()).toEqual(approved);
      expect(
        await apply(
          'export default function Broken(){throw new Error("Keep approved source");return null;}',
        ),
      ).toMatchObject({
        ok: false,
        error: {
          code: "RENDER_FAILED",
          message: expect.stringContaining("Keep approved source"),
        },
      });
      expect(state.snapshot()).toEqual(approved);
      expect(
        await service.execute("update_item", {
          itemId,
          patch: {
            kind: "RemotionGraphic",
            changes: { props: { title_x: 17 } },
          },
        }),
      ).toMatchObject({ ok: true });
      const manifest = join(directory, "edited.forgecut");
      const before = structuredClone(state.project);
      await state.saveProject(manifest);
      await state.loadProject(manifest);
      expect(state.project).toEqual(before);
    } finally {
      await service.jobs.close();
      await service.closeGraphicsPreview();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  },
  90000,
);
