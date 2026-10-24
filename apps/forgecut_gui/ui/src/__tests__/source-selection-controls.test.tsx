import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

afterEach(cleanupSequenceWorkspace);

async function sourceFixture() {
  const fixture = await sequenceWorkspaceFixture();
  fixture.state.executeProjectChange((project) => {
    project.assets.push({
      id: "source-recording",
      name: "Recording.mp4",
      path: "/private/recording.mp4",
      kind: "Video",
      probe: {
        duration_us: 10000000,
        width: 640,
        height: 360,
        fps: 30,
        codec: "h264",
        audio_channels: 2,
        audio_sample_rate: 48000,
      },
    });
  });
  expect(
    await fixture.service.execute(
      "add_track",
      { kind: "Video" },
      { sessionId: fixture.state.sessionId, sequenceId: fixture.root },
    ),
  ).toMatchObject({ ok: true });
  return fixture;
}

it("creates a saved footage selection from the source monitor", async () => {
  const { state, App } = await sourceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(
    screen.getByRole("button", { name: "Review source: Recording.mp4" }),
  );
  await screen.findByText("Source monitor");
  fireEvent.focus(screen.getByLabelText("Source in (s)"));
  fireEvent.change(screen.getByLabelText("Source in (s)"), {
    target: { value: "1" },
  });
  fireEvent.blur(screen.getByLabelText("Source in (s)"));
  fireEvent.focus(screen.getByLabelText("Source out (s)"));
  fireEvent.change(screen.getByLabelText("Source out (s)"), {
    target: { value: "3" },
  });
  fireEvent.blur(screen.getByLabelText("Source out (s)"));
  fireEvent.click(screen.getByRole("button", { name: "New selection" }));
  await waitFor(() => expect(state.project.source_selections).toHaveLength(1));
  expect(state.project.source_selections![0]).toMatchObject({
    asset_id: "source-recording",
    source_in_us: 1000000,
    source_out_us: 3000000,
  });
  expect(
    (screen.getByLabelText("Selection name") as HTMLInputElement).value,
  ).toContain("Recording.mp4");
});

it("keeps manual source notes when an agent changes the range and restores them on reopen", async () => {
  const { state, service, App } = await sourceFixture();
  expect(
    await service.execute("save_source_selection", {
      assetId: "source-recording",
      name: "Opening",
      sourceInUs: 1000000,
      sourceOutUs: 3000000,
      notes: "",
      rationale: "",
    }),
  ).toMatchObject({ ok: true });
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(
    screen.getByRole("button", { name: "Review source: Recording.mp4" }),
  );
  const notes = await screen.findByLabelText("Notes");
  fireEvent.focus(notes);
  fireEvent.change(notes, { target: { value: "Keep the engine sound" } });
  fireEvent.blur(notes);
  await waitFor(() =>
    expect(state.project.source_selections![0].notes).toBe(
      "Keep the engine sound",
    ),
  );
  const selectionId = state.project.source_selections![0].id;
  await act(async () => {
    expect(
      await service.execute("apply_edits", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "agent-range",
        operations: [
          {
            command: "update_source_selection",
            args: { selectionId, patch: { source_in_us: 1500000 } },
          },
        ],
      }),
    ).toMatchObject({ ok: true });
  });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Source in (s)") as HTMLInputElement).value,
    ).toBe("1.5"),
  );
  expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(
    "Keep the engine sound",
  );
  fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
  await screen.findByLabelText("Text");
  fireEvent.click(
    screen.getByRole("button", { name: "Review source: Recording.mp4" }),
  );
  await waitFor(() =>
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(
      "Keep the engine sound",
    ),
  );
});

it("appends the saved source range to the chosen sequence track with one-step undo", async () => {
  const { state, root, service, App } = await sourceFixture();
  expect(
    await service.execute("save_source_selection", {
      assetId: "source-recording",
      name: "Opening",
      sourceInUs: 1500000,
      sourceOutUs: 3000000,
      notes: "Manual note",
      rationale: "Opening shot",
    }),
  ).toMatchObject({ ok: true });
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(
    screen.getByRole("button", { name: "Review source: Recording.mp4" }),
  );
  await screen.findByLabelText("Selection name");
  const before = state.snapshot();
  fireEvent.click(screen.getByRole("button", { name: "Append selection" }));
  await waitFor(() =>
    expect(
      state.project.timeline.tracks
        .flatMap((track) => track.items)
        .some((item) => "VideoClip" in item),
    ).toBe(true),
  );
  const item = state.project.timeline.tracks
    .flatMap((track) => track.items)
    .find((value) => "VideoClip" in value);
  expect(item).toMatchObject({
    VideoClip: {
      asset_id: "source-recording",
      timeline_start_us: 0,
      source_in_us: 1500000,
      source_out_us: 3000000,
    },
  });
  expect(state.snapshot().undoSequenceId).toBe(root);
  expect(state.project.source_selections).toEqual(
    before.project.source_selections,
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(state.project.timeline).toEqual(before.project.timeline),
  );
  expect(state.project.source_selections).toEqual(
    before.project.source_selections,
  );
});
