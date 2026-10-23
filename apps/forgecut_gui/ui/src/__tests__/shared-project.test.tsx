import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../App";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import type {
  EventPayloads,
  ProjectSnapshot,
} from "../../electron/shared/ipc-contract";

afterEach(() => {
  cleanup();
  delete window.forgecut;
  vi.restoreAllMocks();
});

it("keeps the bin, timeline, Inspector and paused preview in sync with edits and whole-project undo", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push({
      id: "image",
      name: "frame.png",
      path: "/frame.png",
      kind: "Image",
      probe: null,
    });
    project.timeline.tracks.push({
      id: "text-track",
      kind: "OverlayText",
      items: [
        {
          TextOverlay: {
            id: "title",
            track_id: "text-track",
            timeline_start_us: 0,
            duration_us: 3_000_000,
            text: "Original",
            font_size: 48,
            color: "#ffffff",
            x: 100,
            y: 100,
          },
        },
      ],
    });
  });
  const service = new EditingService(state);
  const listeners = new Map<
    string,
    Set<(event: { event: string; payload: unknown }) => void>
  >();
  const send = (snapshot: ProjectSnapshot) =>
    listeners
      .get("project-changed")
      ?.forEach((listener) =>
        listener({ event: "project-changed", payload: snapshot }),
      );
  const unsubscribe = state.subscribe(send);
  window.forgecut = {
    invoke: ((command, args, metadata) =>
      service.execute(command, args, metadata)) as NonNullable<
      Window["forgecut"]
    >["invoke"],
    dialog: { open: vi.fn(), save: vi.fn() },
    events: {
      listen: ((
        event: keyof EventPayloads,
        callback: (value: { event: string; payload: unknown }) => void,
      ) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(callback);
        return () => {
          listeners.get(event)!.delete(callback);
        };
      }) as NonNullable<Window["forgecut"]>["events"]["listen"],
    },
    window: { scaleFactor: vi.fn(), onMoved: vi.fn(), onResized: vi.fn() },
    mediaUrl: (path) => path,
  };
  const view = render(<App />);
  await screen.findByText("frame.png");
  const clip = view.container.querySelector(".clip")!;
  fireEvent.mouseDown(clip, { clientX: 100, clientY: 100 });
  fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
  const textInput = await screen.findByLabelText("Text");
  fireEvent.focus(textInput);
  fireEvent.change(textInput, { target: { value: "a" } });
  fireEvent.change(textInput, { target: { value: "ab" } });
  fireEvent.change(textInput, { target: { value: "abc" } });
  expect((textInput as HTMLInputElement).value).toBe("abc");
  await waitFor(() =>
    expect(view.container.querySelector(".clip-label")?.textContent).toBe(
      "abc",
    ),
  );
  fireEvent.blur(textInput);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Original",
    ),
  );
  await waitFor(() =>
    expect(
      within(view.container.querySelector(".preview") as HTMLElement).getByText(
        "Original",
      ),
    ).toBeTruthy(),
  );

  await act(async () => {
    await service.execute("update_item", {
      itemId: "title",
      patch: {
        kind: "TextOverlay",
        changes: { text: "From the service", x: 200 },
      },
    });
  });
  expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
    "From the service",
  );
  expect(view.container.querySelector(".clip-label")?.textContent).toBe(
    "From the service",
  );
  await waitFor(() =>
    expect(
      within(view.container.querySelector(".preview") as HTMLElement).getByText(
        "From the service",
      ),
    ).toBeTruthy(),
  );
  expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe("200");

  await act(async () => {
    state.executeProjectChange((project) => {
      project.assets.push({
        id: "second",
        name: "another.png",
        path: "/another.png",
        kind: "Image",
        probe: null,
      });
    });
  });
  expect(screen.getByText("another.png")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(screen.queryByText("another.png")).toBeNull());

  const stale = state.snapshot();
  await act(async () => {
    await service.execute("delete_clip", { itemId: "title" });
  });
  expect(screen.queryByLabelText("Text")).toBeNull();
  expect(screen.getByText("Project Settings")).toBeTruthy();
  fireEvent.focus(screen.getByLabelText("FPS"));
  fireEvent.change(screen.getByLabelText("FPS"), { target: { value: "24" } });
  fireEvent.blur(screen.getByLabelText("FPS"));
  await waitFor(() =>
    expect((screen.getByLabelText("FPS") as HTMLInputElement).value).toBe("24"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect((screen.getByLabelText("FPS") as HTMLInputElement).value).toBe("30"),
  );
  await act(async () => {
    send(stale);
  });
  expect(view.container.querySelector(".clip")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  view.unmount();
  unsubscribe();
  expect(listeners.get("project-changed")?.size).toBe(0);
});
