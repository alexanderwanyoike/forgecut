import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EditingService } from "../../electron/backend/editing-service";
import type { Project } from "../../electron/shared/ipc-contract";
import { cleanupSequenceWorkspace, sequenceWorkspaceFixture } from "./sequence-workspace-fixture";

let owner: EditingService | undefined;
let directory: string | undefined;
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
});
afterEach(async () => {
  await owner?.batches.close();
  await cleanupSequenceWorkspace();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
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
  state.executeProjectChange(project => {
    project.assets.push({ id: "chosen", name: "Title image", path: chosen, kind: "Image", probe: null }, { id: "external", name: "External image", path: external, kind: "Image", probe: null });
  });
  render(<App />);
  await screen.findByLabelText("Text");
  const before = structuredClone(state.project);
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(await screen.findByRole("button", { name: "Collect project" }));
  const dialog = await screen.findByRole("dialog", { name: "Collect project" });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Include External image" }));
  const output = join(directory, "collection");
  fireEvent.change(within(dialog).getByLabelText("Collection folder"), { target: { value: output } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Collect project" }));
  await within(dialog).findByText("Collection ready", {}, { timeout: 10000 });
  const project: Project = JSON.parse(await readFile(join(output, "project.forgecut"), "utf8"));
  expect(isAbsolute(project.assets[0].path)).toBe(false);
  expect(await readFile(join(output, project.assets[0].path), "utf8")).toBe("chosen media");
  expect(project.assets[1].path).toBe(external);
  expect(state.project).toEqual(before);
}, 15000);
