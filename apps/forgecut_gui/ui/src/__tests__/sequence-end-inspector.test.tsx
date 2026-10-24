import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Inspector from "../components/Inspector";
import { invokeGrouped } from "../lib/bridge";
import type { Project } from "../../electron/shared/ipc-contract";
vi.mock("../lib/bridge", () => ({
  invoke: vi.fn(),
  invokeGrouped: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("sets a sequence end in seconds and returns to automatic duration when cleared", () => {
  const project: Project = {
    id: "project",
    name: "Sequence",
    settings: { width: 640, height: 360, fps: 30, sample_rate: 48000 },
    assets: [],
    timeline: { tracks: [], markers: [] },
  };
  render(<Inspector project={project} selectedClipId={null} />);
  const input = screen.getByLabelText("Sequence end (s)");
  expect(input.getAttribute("placeholder")).toBe("Automatic");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "2.5" } });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "set_sequence_end",
    { endUs: 2500000 },
  );
  fireEvent.change(input, { target: { value: "" } });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "set_sequence_end",
    { endUs: null },
  );
});
