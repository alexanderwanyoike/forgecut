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
