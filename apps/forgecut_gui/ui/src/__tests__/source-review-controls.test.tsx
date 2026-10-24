import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { generateReviewSource } from "../../electron/backend/__tests__/source-review-fixture";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

let directory: string | undefined;
afterEach(async () => {
  await cleanupSequenceWorkspace();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function reviewFixture() {
  const fixture = await sequenceWorkspaceFixture();
  directory = await mkdtemp(join(tmpdir(), "forgecut-source-ui-"));
  const path = join(directory, "recording.mp4");
  generateReviewSource(path);
  expect(
    await fixture.service.execute("import_assets", { paths: [path] }),
  ).toMatchObject({ ok: true });
  render(<fixture.App />);
  await screen.findByLabelText("Text");
  fireEvent.click(
    screen.getByRole("button", { name: "Review source: recording.mp4" }),
  );
  await screen.findByText("Source monitor");
  return fixture;
}

it("reviews a contact sheet for the selected source range without changing the project", async () => {
  const { state } = await reviewFixture();
  const before = state.snapshot();
  fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
  const sheet = await screen.findByRole("img", {
    name: "Source contact sheet",
  });
  expect(sheet.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
  expect(screen.getByText("0.000 to 2.000 seconds")).toBeTruthy();
  await waitFor(() => expect(state.snapshot()).toEqual(before));
});

it("reviews the source waveform without changing the selection or timeline", async () => {
  const { state } = await reviewFixture();
  const before = state.snapshot();
  fireEvent.click(screen.getByRole("button", { name: "Waveform" }));
  const waveform = await screen.findByRole("img", { name: "Source waveform" });
  expect(waveform.tagName.toLowerCase()).toBe("svg");
  expect(waveform.querySelectorAll("line").length).toBeGreaterThan(0);
  expect(waveform.querySelectorAll("line").length).toBeLessThanOrEqual(512);
  expect(screen.getByText("0.000 to 2.000 seconds")).toBeTruthy();
  expect(state.snapshot()).toEqual(before);
});
