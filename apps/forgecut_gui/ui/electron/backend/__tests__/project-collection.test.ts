/** @vitest-environment node */
import { watch, chmodSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
  chmod,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
  vi.unstubAllEnvs();
  if (directory)
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
});

async function terminal(
  owner: EditingService,
  job: JobSnapshot,
): Promise<JobSnapshot> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await owner.execute("get_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    });
    if (!result.ok) throw new Error(result.error.message);
    const current = result.value as JobSnapshot;
    if (["completed", "failed", "cancelled"].includes(current.status))
      return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Collection did not reach a terminal state");
}

it("collects chosen media and graphic source from a captured revision without changing current edits", async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-collect-"));
  const selected = join(directory, "selected.png");
  const external = join(directory, "external.png");
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const cache = join(directory, "resource-cache");
  vi.stubEnv("FORGECUT_RESOURCE_DIR", cache);
  await writeFile(selected, image);
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
  expect(
    await service.execute("import_graphic_resource", {
      path: selected,
      kind: "Image",
      license: { identifier: "Original", text: "Generated fixture artwork" },
    }),
  ).toMatchObject({ ok: true });
  const fontRoot = join(
    process.cwd(),
    "node_modules",
    "@fontsource",
    "ibm-plex-sans",
  );
  expect(
    await service.execute("import_graphic_resource", {
      path: join(fontRoot, "files", "ibm-plex-sans-latin-400-normal.woff2"),
      kind: "Font",
      license: {
        identifier: "OFL-1.1",
        text: await readFile(join(fontRoot, "LICENSE"), "utf8"),
      },
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
  const completed = await terminal(service, job);
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
  expect(await readFile(join(output, project.assets[0].path))).toEqual(image);
  expect(project.assets[1].path).toBe(external);
  expect(project.resources).toEqual(captured.project.resources);
  for (const resource of project.resources ?? [])
    expect(await readFile(join(output, resource.path))).toEqual(
      await readFile(join(cache, resource.sha256)),
    );
  await rm(cache, { recursive: true });
  await rm(selected);
  const moved = join(directory, "moved");
  await rename(output, moved);
  const reopened = new AppState();
  await reopened.loadProject(join(moved, "project.forgecut"));
  expect(reopened.snapshot().missingMedia).toEqual([]);
  expect(reopened.project.components).toEqual(captured.project.components);
  expect(reopened.project.resources).toEqual(captured.project.resources);
});

it("cancels collection during destination preparation and removes only its new folder", async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-collect-cancel-"));
  const state = new AppState();
  service = new EditingService(state);
  const output = join(directory, "cancelled");
  const queued = await service.execute("collect_project", {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: crypto.randomUUID(),
    directory: output,
    assetIds: [],
  });
  expect(queued.ok).toBe(true);
  if (!queued.ok) throw new Error(queued.error.message);
  const job = queued.value as JobSnapshot;
  expect(
    await service.execute("cancel_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    }),
  ).toMatchObject({ ok: true });
  await service.jobs.close();
  expect(
    await service.execute("get_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    }),
  ).toMatchObject({ ok: true, value: { status: "cancelled" } });
  expect(await stat(output).catch(() => null)).toBeNull();
});

it("preserves existing destinations and rejects stale or unknown collection inputs", async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-collect-existing-"));
  const state = new AppState();
  service = new EditingService(state);
  const output = join(directory, "existing");
  await mkdir(output);
  await writeFile(join(output, "keep.txt"), "Keep this file");
  const request = {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: crypto.randomUUID(),
    directory: output,
    assetIds: [],
  };
  expect(
    await service.execute("collect_project", {
      ...request,
      expectedRevision: state.revision + 1,
    }),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(
    await service.execute("collect_project", {
      ...request,
      assetIds: ["unknown"],
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  const queued = await service.execute("collect_project", request);
  expect(queued.ok).toBe(true);
  if (!queued.ok) throw new Error(queued.error.message);
  const job = queued.value as JobSnapshot;
  const status = await terminal(service, job);
  expect(status).toMatchObject({
    status: "failed",
    result: { ok: false, error: { code: "CONFLICT" } },
  });
  expect(await readFile(join(output, "keep.txt"), "utf8")).toBe(
    "Keep this file",
  );
});

it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
  "reports the original failure and recovery folder when cleanup is denied",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "forgecut-collect-cleanup-"));
    const root = directory;
    const output = join(root, "partial");
    const source = join(root, "not-a-file");
    await mkdir(source);
    const state = new AppState();
    service = new EditingService(state);
    state.executeProjectChange((project) => {
      project.assets.push({
        id: "invalid-file",
        name: "Unavailable image",
        path: source,
        kind: "Image",
        probe: null,
      });
    });
    let denied = false;
    const watcher = watch(root, (_, name) => {
      if (name?.toString() !== "partial") return;
      denied = true;
      chmodSync(root, 0o500);
    });
    try {
      const queued = await service.execute("collect_project", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: crypto.randomUUID(),
        directory: output,
        assetIds: ["invalid-file"],
      });
      expect(queued.ok).toBe(true);
      if (!queued.ok) throw new Error(queued.error.message);
      const completed = await terminal(service, queued.value as JobSnapshot);
      expect(denied).toBe(true);
      expect(completed).toMatchObject({
        status: "failed",
        result: {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: expect.stringContaining("regular files"),
          },
        },
      });
      expect(completed.result).toMatchObject({
        ok: false,
        error: {
          message: expect.stringContaining(
            `Collection cleanup failed at ${output}`,
          ),
        },
      });
      expect((await stat(output)).isDirectory()).toBe(true);
    } finally {
      watcher.close();
      await chmod(root, 0o700);
    }
  },
  15000,
);
