/** @vitest-environment node */
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { JobSnapshot } from "../../shared/jobs";
import type { Project } from "../../shared/ipc-contract";

let service: EditingService | undefined;
let directory: string | undefined;
let release = () => {};
afterEach(async () => {
  release();
  await service?.jobs.close();
  await service?.closeGraphicsPreview();
  if (directory)
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
});

it("collects chosen media and graphic source from a captured revision without changing current edits", async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-collect-"));
  const selected = join(directory, "selected.png");
  const external = join(directory, "external.png");
  await writeFile(selected, "selected bytes");
  await writeFile(external, "external bytes");
  const state = new AppState();
  service = new EditingService(state);
  state.executeProjectChange((project) => {
    project.assets.push(
      ...[selected, external].map((path, index) => ({
        id: `asset-${index}`,
        name: `Image ${index}`,
        path,
        kind: "Image" as const,
        probe: null,
        license: { identifier: "Original", text: "Fixture media" },
      })),
    );
  });
  expect(
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { title: "Captured words" },
    }),
  ).toMatchObject({ ok: true });
  const captured = state.snapshot();
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  service.jobs.start(
    {
      sessionId: state.sessionId,
      projectRevision: state.revision,
      requestId: "held",
      kind: "frame",
      label: "Held job",
      input: null,
    },
    async () => {
      await held;
      return { ok: true, value: null };
    },
  );
  const output = join(directory, "collection");
  const request = {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: crypto.randomUUID(),
    directory: output,
    assetIds: ["asset-0"],
  };
  const queued = await service.execute("collect_project", request);
  expect(queued).toMatchObject({ ok: true, value: { kind: "collect" } });
  if (!queued.ok) throw new Error(queued.error.message);
  const job = queued.value as JobSnapshot;
  state.executeProjectChange((project) => {
    project.name = "Manual edit after capture";
  });
  const current = state.snapshot();
  release();
  let completed: JobSnapshot | undefined;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await service.execute("get_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) completed = result.value as JobSnapshot;
    if (
      completed &&
      ["completed", "failed", "cancelled"].includes(completed.status)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(completed).toMatchObject({
    status: "completed",
    result: { ok: true },
  });
  expect(state.snapshot()).toEqual(current);
  const project: Project = JSON.parse(
    await readFile(join(output, "project.forgecut"), "utf8"),
  );
  expect(project.name).toBe(captured.project.name);
  expect(project.components).toEqual(captured.project.components);
  expect(project.assets[0].license).toEqual(captured.project.assets[0].license);
  expect(isAbsolute(project.assets[0].path)).toBe(false);
  expect(await readFile(join(output, project.assets[0].path), "utf8")).toBe(
    "selected bytes",
  );
  expect(project.assets[1].path).toBe(external);
  const moved = join(directory, "moved");
  await rename(output, moved);
  const reopened = new AppState();
  await reopened.loadProject(join(moved, "project.forgecut"));
  expect(reopened.snapshot().missingMedia).toEqual([]);
  expect(reopened.project.components).toEqual(captured.project.components);
});
