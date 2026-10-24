import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ExportDialog from "../components/ExportDialog";

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  invokeInContext: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../lib/bridge", () => api);
beforeEach(() => vi.clearAllMocks());

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

it("keeps cancellation details visible when staging cleanup also fails", async () => {
  api.save.mockResolvedValue("/result.mp4");
  api.invoke.mockResolvedValue({
    id: "cancelled",
    sessionId: "session",
    projectRevision: 1,
    requestId: "export",
    kind: "export",
    label: "Export",
    status: "cancelled",
    progress: 0.5,
    result: {
      ok: false,
      error: {
        code: "CANCELLED",
        message:
          "Export cancelled. Staging cleanup failed at /temporary/export.",
      },
    },
  });
  render(<ExportDialog open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByText("Export cancelled");
  expect(screen.getByText(/Staging cleanup failed at/)).toBeTruthy();
});

it("exports a review range from the captured sequence target", async () => {
  api.save.mockResolvedValue("/review.mp4");
  api.invokeInContext.mockResolvedValue({
    id: "review",
    sessionId: "original",
    projectRevision: 1,
    requestId: "review",
    kind: "export",
    label: "Review export",
    status: "completed",
    progress: 1,
    result: { ok: true, value: { outputPath: "/review.mp4" } },
  });
  const target = {
    sessionId: "original",
    sequenceId: "clip",
    name: "Clip",
    durationUs: 2000000,
    playheadUs: 1250000,
  };
  render(<ExportDialog open target={target} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Review a range" }));
  fireEvent.change(screen.getByLabelText("Review end (s)"), {
    target: { value: "1.85" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() =>
    expect(api.invokeInContext).toHaveBeenCalledWith(target, "export_project", {
      outputPath: "/review.mp4",
      sequenceId: "clip",
      range: { startUs: 1250000, endUs: 1850000 },
    }),
  );
});

it("blocks invalid review ranges and allows switching back to a full export", () => {
  const target = {
    sessionId: "validation",
    sequenceId: "clip",
    name: "Clip",
    durationUs: 40000000,
    playheadUs: 0,
  };
  render(<ExportDialog open target={target} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Review a range" }));
  for (const [start, end] of [
    ["", "1"],
    ["0", "31"],
    ["5", "4"],
  ]) {
    fireEvent.change(screen.getByLabelText("Review start (s)"), {
      target: { value: start },
    });
    fireEvent.change(screen.getByLabelText("Review end (s)"), {
      target: { value: end },
    });
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
  }
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Review a range" }));
  expect(
    (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reopens the dialog with a full export instead of a previous review draft", async () => {
  api.save.mockResolvedValue("/full.mp4");
  api.invokeInContext.mockResolvedValue({
    id: "full",
    sessionId: "reopen",
    projectRevision: 1,
    requestId: "full",
    kind: "export",
    label: "Export",
    status: "completed",
    progress: 1,
    result: { ok: true, value: { outputPath: "/full.mp4" } },
  });
  const target = {
    sessionId: "reopen",
    sequenceId: "clip",
    name: "Clip",
    durationUs: 2000000,
    playheadUs: 0,
  };
  const view = render(<ExportDialog open target={target} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Review a range" }));
  view.rerender(
    <ExportDialog open={false} target={target} onClose={() => {}} />,
  );
  view.rerender(<ExportDialog open target={target} onClose={() => {}} />);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Review a range",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() =>
    expect(api.invokeInContext).toHaveBeenCalledWith(target, "export_project", {
      outputPath: "/full.mp4",
      sequenceId: "clip",
    }),
  );
});
