import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { cleanupSequenceWorkspace, sequenceWorkspaceFixture } from "./sequence-workspace-fixture";

afterEach(cleanupSequenceWorkspace);

it("exposes file and export actions as named keyboard-focusable controls", async () => {
  const { App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  const file = screen.getByRole("button", { name: "File" });
  file.focus();
  expect(document.activeElement).toBe(file);
  fireEvent.click(file);
  expect(screen.getByRole("button", { name: "Open Project..." })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save Project..." })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
});

it("describes the compact sequence action when it receives keyboard focus", async () => {
  const { App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  screen.getByRole("button", { name: "Rename sequence" }).focus();
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", "Rename sequence");
});
