import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import { GraphicPreviewService } from "../../electron/backend/GraphicPreviewService";
import type { JobSnapshot } from "../../electron/shared/jobs";
import type { GraphicDraft } from "../../electron/shared/graphic-draft";
import CodeWorkspace from "../components/CodeWorkspace";
const { bridge } = vi.hoisted(() => ({ bridge: vi.fn() }));
vi.mock("node:fs", () => ({
  readFileSync: () => titleSource,
  default: { readFileSync: () => titleSource },
}));
vi.mock("../lib/bridge", () => ({ invoke: bridge }));
vi.mock("../components/MonacoSourceEditor", () => ({
  default: ({
    files,
    path,
    onChange,
  }: {
    files: Record<string, string>;
    path: string;
    onChange: (path: string, value: string) => void;
  }) => (
    <textarea
      aria-label="Graphic source editor"
      value={files[path] ?? ""}
      onChange={(event) => onChange(path, event.currentTarget.value)}
    />
  ),
}));
let directory: string;
let service: EditingService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-code-ui-"));
  vi.stubEnv("FORGECUT_DRAFT_DIR", directory);
});
afterEach(async () => {
  cleanup();
  if (service) {
    await service.jobs.close();
    await service.closeGraphicsPreview();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const state = new AppState();
  service = new EditingService(state);
  vi.spyOn(GraphicPreviewService.prototype, "render").mockResolvedValue({
    ok: true,
    value: { mimeType: "image/png", data: "AA==", width: 64, height: 36 },
  });
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
    props: { title: "Manual wording" },
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  const itemId = item.RemotionGraphic.id;
  bridge.mockImplementation(async (command: string, args: unknown) => {
    if (command === "check_graphic_source")
      return { ok: true, value: { code: "checked" } };
    const result = await service.execute(command, args);
    if (!result.ok)
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
        diagnostics: result.error.diagnostics,
      });
    return result.value;
  });
  function Harness() {
    const [snapshot, setSnapshot] = useState(state.snapshot());
    useEffect(() => state.subscribe(setSnapshot), []);
    return (
      <CodeWorkspace snapshot={snapshot} itemId={itemId} onClose={() => {}} />
    );
  }
  render(<Harness />);
  await screen.findByLabelText("Graphic source editor");
  return { state, itemId };
}
it("saves a recoverable buffer, previews it separately and applies one project edit", async () => {
  const { state, itemId } = await fixture();
  const before = state.snapshot();
  const code =
    "export default function Card({values}:ForgeCut.Props){return <div>{values.title}</div>}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: code },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  expect(state.snapshot()).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Preview draft" }));
  await screen.findByAltText("Draft preview");
  expect(state.snapshot()).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Apply source" }));
  await waitFor(() => expect(state.revision).toBe(before.revision + 1));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Source applied"),
  );
  const active = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in active)) throw new Error("Missing graphic");
  expect(active.RemotionGraphic.props.title).toBe("Manual wording");
  expect(await service.execute("get_graphic_draft", { itemId })).toMatchObject({
    ok: true,
    value: { baseVersion: active.RemotionGraphic.component_version },
  });
});
it("retains a manual buffer on an agent conflict and merges only explicitly chosen edited files", async () => {
  const { state, itemId } = await fixture();
  const loaded = await service.execute("get_graphic_draft", { itemId });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const original = loaded.value as GraphicDraft;
  const component = structuredClone(original.component);
  component.properties.title.label = "Agent label";
  component.source.files[component.source.entry] += "\n// agent draft";
  await service.execute("save_graphic_draft", {
    itemId,
    sessionId: state.sessionId,
    expectedDraftRevision: 0,
    baseVersion: original.baseVersion,
    component,
  });
  const code = "export default function Card(){return <div>My edit</div>}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: code },
  });
  await screen.findByRole("button", { name: "Keep edited files" });
  expect(
    (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
      .value,
  ).toBe(code);
  fireEvent.click(screen.getByRole("button", { name: "Keep edited files" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  const saved = await service.execute("get_graphic_draft", { itemId });
  expect(saved).toMatchObject({
    ok: true,
    value: {
      revision: 2,
      component: {
        properties: { title: { label: "Agent label" } },
        source: { files: { [component.source.entry]: code } },
      },
    },
  });
});
it("shows a new agent draft live when the editor has no unsaved buffer", async () => {
  const { state, itemId } = await fixture();
  const loaded = await service.execute("get_graphic_draft", { itemId });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const original = loaded.value as GraphicDraft;
  original.component.source.files[original.component.source.entry] =
    "export default function Updated(){return null}";
  await service.execute("save_graphic_draft", {
    itemId,
    sessionId: state.sessionId,
    expectedDraftRevision: 0,
    baseVersion: original.baseVersion,
    component: original.component,
  });
  await waitFor(
    () =>
      expect(
        (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
          .value,
      ).toContain("Updated"),
    { timeout: 3000 },
  );
});
it("keeps the window open until the latest source buffer is recoverably saved", async () => {
  const { state, itemId } = await fixture();
  let release: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = bridge.getMockImplementation()!;
  bridge.mockImplementation(async (command: string, args: unknown) => {
    if (command === "save_graphic_draft") await paused;
    return execute(command, args);
  });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  const code = "export default function Recoverable(){return null}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: code },
  });
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
  release!();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = await service.execute("get_graphic_draft", { itemId });
  expect(saved).toMatchObject({
    ok: true,
    value: { component: { source: { files: { "main.tsx": code } } } },
  });
  expect(state.project.components).toHaveLength(1);
});
it("retains typing made while Apply is refreshing the saved draft", async () => {
  const { state } = await fixture();
  const first = "export default function Applied(){return <div>First</div>}";
  const latest =
    "export default function Continued(){return <div>My next edit</div>}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: first },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  let release: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = bridge.getMockImplementation()!;
  bridge.mockImplementation(async (command: string, args: unknown) => {
    const result = await execute(command, args);
    if (command === "get_graphic_draft" && state.revision > 1) await paused;
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply source" }));
  await waitFor(() => expect(state.revision).toBe(2));
  await waitFor(() =>
    expect(
      bridge.mock.calls.filter(([command]) => command === "get_graphic_draft")
        .length,
    ).toBeGreaterThan(2),
  );
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: latest },
  });
  release!();
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Source applied"),
  );
  expect(
    (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
      .value,
  ).toBe(latest);
});
it("allows Revert to reconcile a draft after project undo restores older active source", async () => {
  const { state } = await fixture();
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: "export default function Updated(){return null}" },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply source" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Source applied"),
  );
  await service.execute("undo", undefined);
  await screen.findByText(
    "The active source changed. Reconcile the draft before continuing.",
  );
  expect(
    (screen.getByRole("button", { name: "Revert draft" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Revert draft" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Keep edited files" }),
    ).toBeNull(),
  );
  const component = state.project.components![0];
  expect(
    (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
      .value,
  ).toBe(component.source.files[component.source.entry]);
});

it("ignores a poll response older than a newly acknowledged manual save", async () => {
  await fixture();
  const execute = bridge.getMockImplementation()!;
  let release: (() => void) | undefined;
  let began: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let held = false;
  bridge.mockImplementation(async (command: string, args: unknown) => {
    const result = await execute(command, args);
    if (command === "get_graphic_draft" && !held) {
      held = true;
      began!();
      await paused;
    }
    return result;
  });
  await started;
  const code = "export default function Latest(){return null}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: code },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  await act(async () => {
    release!();
  });
  expect(
    (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
      .value,
  ).toBe(code);
});
it("retains typing made while Keep edited files reads the agent draft", async () => {
  const { state, itemId } = await fixture();
  const loaded = await service.execute("get_graphic_draft", { itemId });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const original = loaded.value as GraphicDraft;
  const component = structuredClone(original.component);
  component.properties.title.label = "Agent label";
  await service.execute("save_graphic_draft", {
    itemId,
    sessionId: state.sessionId,
    expectedDraftRevision: 0,
    baseVersion: original.baseVersion,
    component,
  });
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: "export default function Earlier(){return null}" },
  });
  await screen.findByRole("button", { name: "Keep edited files" });
  const execute = bridge.getMockImplementation()!;
  let release: (() => void) | undefined;
  let began: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let held = false;
  bridge.mockImplementation(async (command: string, args: unknown) => {
    const result = await execute(command, args);
    if (command === "get_graphic_draft" && !held) {
      held = true;
      began!();
      await paused;
    }
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep edited files" }));
  await started;
  const latest =
    "export default function Later(){return <div>New typing</div>}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: latest },
  });
  await act(async () => {
    release!();
  });
  expect(
    (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
      .value,
  ).toBe(latest);
  fireEvent.click(screen.getByRole("button", { name: "Keep edited files" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  expect(await service.execute("get_graphic_draft", { itemId })).toMatchObject({
    ok: true,
    value: {
      component: {
        properties: { title: { label: "Agent label" } },
        source: { files: { "main.tsx": latest } },
      },
    },
  });
});

it("shows successful Apply warnings without claiming publication failed", async () => {
  const { state } = await fixture();
  const execute = bridge.getMockImplementation()!;
  const warning = "Source applied; draft persistence failed";
  bridge.mockImplementation(async (command: string, args: unknown) => {
    const result = await execute(command, args);
    if (command === "get_media_job") {
      const job = result as JobSnapshot;
      if (job.status === "completed" && job.result?.ok)
        return {
          ...job,
          result: {
            ok: true,
            value: { ...(job.result.value as object), warning },
          },
        };
    }
    return result;
  });
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: "export default function Applied(){return null}" },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply source" }));
  await screen.findByText(warning);
  expect(screen.getByRole("status").textContent).toContain("Source applied");
  expect(state.revision).toBe(2);
});
it("retains typing made after Revert starts while its acknowledgement is delayed", async () => {
  await fixture();
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: "export default function Earlier(){return null}" },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Draft saved"),
  );
  const execute = bridge.getMockImplementation()!;
  let release: (() => void) | undefined;
  let began: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  bridge.mockImplementation(async (command: string, args: unknown) => {
    const result = await execute(command, args);
    if (command === "revert_graphic_draft") {
      began!();
      await paused;
    }
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Revert draft" }));
  await started;
  const latest =
    "export default function Later(){return <div>After Revert</div>}";
  fireEvent.change(screen.getByLabelText("Graphic source editor"), {
    target: { value: latest },
  });
  await screen.findByRole("button", { name: "Keep edited files" });
  await act(async () => {
    release!();
  });
  expect(
    (screen.getByLabelText("Graphic source editor") as HTMLTextAreaElement)
      .value,
  ).toBe(latest);
});

it("offers a source location for an isolated draft runtime failure", async () => {
  await fixture();
  vi.spyOn(GraphicPreviewService.prototype, "render").mockResolvedValueOnce({
    ok: false,
    error: {
      code: "RENDER_FAILED",
      message: "Mapped runtime failure",
      diagnostics: [
        {
          file: "main.tsx",
          line: 1,
          column: 40,
          message: "Mapped runtime failure",
        },
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview draft" }));
  await screen.findByRole("button", {
    name: "main.tsx:1:40 Mapped runtime failure",
  });
});
