import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ExportDialog from "../components/ExportDialog";

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../lib/bridge", () => api);

it("shows a queued export and cancels the same scoped job", async () => {
  api.save.mockResolvedValue("/result.mp4");
  const job = {
    id: "job",
    sessionId: "original",
    projectRevision: 1,
    requestId: "export",
    kind: "export",
    label: "Export",
    status: "queued",
    progress: 0,
    result: null,
  };
  api.invoke.mockImplementation(async (command: string) => {
    if (command === "export_project" || command === "get_media_job") return job;
    if (command === "cancel_media_job")
      return {
        ...job,
        status: "cancelled",
        result: {
          ok: false,
          error: { code: "CANCELLED", message: "Export cancelled." },
        },
      };
    throw new Error(`Unexpected command ${command}`);
  });
  render(<ExportDialog open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
  await waitFor(() =>
    expect(screen.getByText("Export cancelled")).toBeTruthy(),
  );
  expect(api.invoke).toHaveBeenCalledWith("cancel_media_job", {
    sessionId: "original",
    jobId: "job",
  });
});
