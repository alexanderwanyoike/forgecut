import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ExportDialog from "../components/ExportDialog";

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
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

it("allows a new export when an old job result is no longer retained", async () => {
  api.save.mockResolvedValue("/result.mp4");
  api.invoke.mockImplementation(async (command: string) => {
    if (command === "export_project")
      return {
        id: "evicted",
        sessionId: "session",
        projectRevision: 1,
        requestId: "export",
        kind: "export",
        label: "Export",
        status: "queued",
        progress: 0,
        result: null,
      };
    throw Object.assign(new Error("Job result is no longer retained."), {
      code: "NOT_FOUND",
    });
  });
  render(<ExportDialog open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
});

it("shows a cleanup diagnostic without misreporting a published export as failed", async () => {
  api.save.mockResolvedValue("/result.mp4");
  api.invoke.mockResolvedValue({
    id: "complete",
    sessionId: "session",
    projectRevision: 1,
    requestId: "export",
    kind: "export",
    label: "Export",
    status: "completed",
    progress: 1,
    result: {
      ok: true,
      value: {
        outputPath: "/result.mp4",
        cleanupWarning: "Temporary export files could not be removed.",
      },
    },
  });
  render(<ExportDialog open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByText("Export complete");
  expect(screen.getByRole("alert").textContent).toContain(
    "Temporary export files could not be removed.",
  );
});
