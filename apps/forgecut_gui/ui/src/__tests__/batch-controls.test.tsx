import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EditingService } from "../../electron/backend/editing-service";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

let owner: EditingService | undefined;
let root: string | undefined;
let release = () => {};
const originalShowModal = Object.getOwnPropertyDescriptor(
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
  release();
  await owner?.batches.close();
  await cleanupSequenceWorkspace();
  if (root) await rm(root, { recursive: true, force: true });
  localStorage.removeItem("forgecut.exportBatchDirectory");
  if (originalShowModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalShowModal,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

it("creates the chosen output from the file menu and pauses it without changing the project", async () => {
  const { state, service, App, clip } = await sequenceWorkspaceFixture();
  owner = service;
  root = await mkdtemp(join(tmpdir(), "forgecut-batch-controls-"));
  const directory = join(root, "exports");
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  service.jobs.start(
    {
      sessionId: state.sessionId,
      projectRevision: state.revision,
      requestId: "hold-ui",
      kind: "frame",
      label: "Held media job",
      input: null,
    },
    async () => {
      await held;
      return { ok: true, value: null };
    },
  );
  render(<App />);
  await screen.findByLabelText("Text");
  const before = structuredClone(state.project);
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(await screen.findByRole("button", { name: "Batch exports" }));
  await screen.findByRole("dialog", { name: "Batch exports" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Export Main" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Batch format" }), {
    target: { value: "webm" },
  });
  fireEvent.change(screen.getByLabelText("Batch folder"), {
    target: { value: directory },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create and export" }));
  await screen.findByRole("button", { name: "Pause batch" });
  const manifest = JSON.parse(
    await readFile(join(directory, "batch.json"), "utf8"),
  );
  expect(manifest.entries).toEqual([
    expect.objectContaining({ sequenceId: clip, preset: "webm" }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Pause batch" }));
  await waitFor(() => expect(screen.getByText("Paused")).toBeTruthy(), {
    timeout: 3000,
  });
  expect(state.project).toEqual(before);
  expect(
    screen.getByRole("button", { name: "Retry unfinished exports" }),
  ).toBeTruthy();
});
