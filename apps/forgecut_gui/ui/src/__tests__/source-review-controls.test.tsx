import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type {
  CommandMetadata,
  CommandResponse,
} from "../../electron/shared/ipc-contract";
import { generateReviewSource } from "../../electron/backend/__tests__/source-review-fixture";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

const mediaTest = it.skipIf(
  ["ffmpeg", "ffprobe"].some(
    (tool) => spawnSync(tool, ["-version"]).status !== 0,
  ),
);

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

mediaTest(
  "reviews a contact sheet for the selected source range without changing the project",
  async () => {
    const { state } = await reviewFixture();
    const before = state.snapshot();
    fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
    const sheet = await screen.findByRole("img", {
      name: "Source contact sheet",
    });
    expect(sheet.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
    expect(screen.getByText("0.000 to 2.000 seconds")).toBeTruthy();
    await waitFor(() => expect(state.snapshot()).toEqual(before));
  },
);

mediaTest(
  "reviews the source waveform without changing the selection or timeline",
  async () => {
    const { state } = await reviewFixture();
    const before = state.snapshot();
    fireEvent.click(screen.getByRole("button", { name: "Waveform" }));
    const waveform = await screen.findByRole("img", {
      name: "Source waveform",
    });
    expect(waveform.tagName.toLowerCase()).toBe("svg");
    expect(waveform.querySelectorAll("line").length).toBeGreaterThan(0);
    expect(waveform.querySelectorAll("line").length).toBeLessThanOrEqual(512);
    expect(screen.getByText("0.000 to 2.000 seconds")).toBeTruthy();
    expect(state.snapshot()).toEqual(before);
  },
);

mediaTest(
  "ignores and cancels a delayed job when its source range changes",
  async () => {
    const { state } = await reviewFixture();
    const native = window.forgecut!.invoke;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delayed = false;
    let started = false;
    const cancelled: Record<string, unknown>[] = [];
    window.forgecut!.invoke = async <T,>(
      command: string,
      args?: Record<string, unknown>,
      metadata?: CommandMetadata,
    ): Promise<CommandResponse<T>> => {
      if (command === "cancel_media_job") cancelled.push(args ?? {});
      const response = await native<T>(command, args, metadata);
      if (command === "start_source_review" && !delayed) {
        delayed = true;
        started = true;
        await gate;
      }
      return response;
    };
    const before = state.snapshot();
    fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
    await waitFor(() => expect(started).toBe(true));
    fireEvent.focus(screen.getByLabelText("Source out (s)"));
    fireEvent.change(screen.getByLabelText("Source out (s)"), {
      target: { value: "1" },
    });
    fireEvent.blur(screen.getByLabelText("Source out (s)"));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(cancelled.length).toBe(1));
    expect(cancelled[0].sessionId).toBe(state.sessionId);
    expect(
      screen.queryByRole("img", { name: "Source contact sheet" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
    await screen.findByRole("img", { name: "Source contact sheet" });
    expect(screen.getByText("0.000 to 1.000 seconds")).toBeTruthy();
    expect(state.snapshot()).toEqual(before);
  },
);

mediaTest(
  "clears a completed review when its asset is relinked to another recording",
  async () => {
    const { state, service } = await reviewFixture();
    fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
    await screen.findByRole("img", { name: "Source contact sheet" });
    const asset = state.project.assets[0];
    const replacement = join(directory!, "replacement.mp4");
    await copyFile(asset.path, replacement);
    await act(async () => {
      expect(
        await service.execute("relink_asset", {
          id: asset.id,
          path: replacement,
        }),
      ).toMatchObject({ ok: true });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: "Source contact sheet" }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
    await screen.findByRole("img", { name: "Source contact sheet" });
    expect(state.project.assets[0].path).toBe(replacement);
  },
);

mediaTest(
  "plays a bounded source preview without changing the project",
  async () => {
    const { state } = await reviewFixture();
    const before = state.snapshot();
    fireEvent.click(screen.getByRole("button", { name: "Short preview" }));
    const video = await screen.findByLabelText("Source preview");
    expect(video.tagName.toLowerCase()).toBe("video");
    expect(video.getAttribute("src")).toMatch(/^data:video\/webm;base64,/);
    expect((video as HTMLVideoElement).controls).toBe(true);
    expect(screen.getByText("0.000 to 2.000 seconds")).toBeTruthy();
    expect(state.snapshot()).toEqual(before);
  },
);
