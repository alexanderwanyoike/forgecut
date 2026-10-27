import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EditingService } from "../../electron/backend/editing-service";
import type { Project } from "../../electron/shared/ipc-contract";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

let owner: EditingService | undefined;
let directory: string | undefined;
let release = () => {};
let finishReply = () => {};
const showModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
});
afterEach(async () => {
  finishReply();
  release();
  await owner?.batches.close();
  await cleanupSequenceWorkspace();
  if (directory)
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  if (showModal)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

it("collects chosen media from the file menu while preserving the editable project", async () => {
  const { state, service, App } = await sequenceWorkspaceFixture();
  owner = service;
  directory = await mkdtemp(join(tmpdir(), "forgecut-collection-controls-"));
  const chosen = join(directory, "chosen.png");
  const external = join(directory, "external.png");
  await writeFile(chosen, "chosen media");
  await writeFile(external, "external media");
  state.executeProjectChange((project) => {
    project.assets.push(
      {
        id: "chosen",
        name: "Title image",
        path: chosen,
        kind: "Image",
        probe: null,
      },
      {
        id: "external",
        name: "External image",
        path: external,
        kind: "Image",
        probe: null,
      },
    );
  });
  render(<App />);
  await screen.findByLabelText("Text");
  const before = structuredClone(state.project);
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Collect project" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Collect project" });
  fireEvent.click(
    within(dialog).getByRole("checkbox", { name: "Include External image" }),
  );
  const output = join(directory, "collection");
  fireEvent.change(within(dialog).getByLabelText("Collection folder"), {
    target: { value: output },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Collect project" }),
  );
  await within(dialog).findByText("Collection ready", {}, { timeout: 10000 });
  const project: Project = JSON.parse(
    await readFile(join(output, "project.forgecut"), "utf8"),
  );
  expect(isAbsolute(project.assets[0].path)).toBe(false);
  expect(await readFile(join(output, project.assets[0].path), "utf8")).toBe(
    "chosen media",
  );
  expect(project.assets[1].path).toBe(external);
  fireEvent.keyDown(dialog, { key: "Delete" });
  expect(state.project).toEqual(before);
}, 15000);

it("keeps an accepted collection accessible after closing and switching projects during its response", async () => {
  const { state, service, App } = await sequenceWorkspaceFixture();
  owner = service;
  directory = await mkdtemp(join(tmpdir(), "forgecut-collection-close-"));
  const output = join(directory, "collection");
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  service.jobs.start(
    {
      sessionId: state.sessionId,
      projectRevision: state.revision,
      requestId: "hold-collection",
      kind: "frame",
      label: "Held media job",
      input: null,
    },
    async () => {
      await held;
      return { ok: true, value: null };
    },
  );
  let captured = () => {};
  const created = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const reply = new Promise<void>((resolve) => {
    finishReply = resolve;
  });
  const api = window.forgecut!;
  const original = api.invoke;
  api.invoke = async <T,>(...args: Parameters<typeof original>) => {
    const result = await original<T>(...args);
    if (args[0] === "collect_project") {
      captured();
      await reply;
    }
    return result;
  };
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Collect project" }),
  );
  fireEvent.change(screen.getByLabelText("Collection folder"), {
    target: { value: output },
  });
  fireEvent.click(screen.getByRole("button", { name: "Collect project" }));
  await created;
  fireEvent.click(
    screen.getByRole("button", { name: "Close project collection" }),
  );
  await act(async () => {
    expect(await service.execute("create_project")).toMatchObject({ ok: true });
  });
  const before = structuredClone(state.project);
  await act(async () => {
    finishReply();
    await reply;
  });
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Collect project" }),
  );
  await screen.findByText("Queued");
  fireEvent.click(screen.getByRole("button", { name: "Cancel collection" }));
  await screen.findByText("Collection cancelled");
  expect(await stat(output).catch(() => null)).toBeNull();
  expect(state.project).toEqual(before);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Collect project" }), {
    key: "Delete",
  });
  expect(state.project).toEqual(before);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Collect project" }), {
    key: "Escape",
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Collect project" }),
    ).toBeNull(),
  );
}, 15000);

it("keeps the typed destination while an agent edits the project and captures the visible revision", async () => {
  const { state, service, App, root } = await sequenceWorkspaceFixture();
  owner = service;
  directory = await mkdtemp(join(tmpdir(), "forgecut-collection-draft-"));
  const output = join(directory, "collection");
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Collect project" }),
  );
  fireEvent.change(screen.getByLabelText("Collection folder"), {
    target: { value: output },
  });
  await act(async () => {
    expect(
      await service.execute(
        "update_project",
        { name: "Updated by agent" },
        { sequenceId: root },
      ),
    ).toMatchObject({ ok: true });
  });
  expect(screen.getByLabelText("Collection folder")).toHaveProperty(
    "value",
    output,
  );
  fireEvent.click(screen.getByRole("button", { name: "Collect project" }));
  await screen.findByText("Collection ready", {}, { timeout: 10000 });
  const project: Project = JSON.parse(
    await readFile(join(output, "project.forgecut"), "utf8"),
  );
  expect(project.name).toBe("Updated by agent");
  expect(state.project.name).toBe("Updated by agent");
}, 15000);
