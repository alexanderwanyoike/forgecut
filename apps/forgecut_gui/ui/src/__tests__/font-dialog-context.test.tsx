import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ResourceProperty from "../components/ResourceProperty";
import { open, invoke } from "../lib/bridge";

vi.mock("../lib/bridge", () => ({
  open: vi.fn(),
  invoke: vi.fn().mockResolvedValue(null),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps the project identity from before the font dialogs opened", async () => {
  let choose!: (path: string) => void;
  vi.mocked(open)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        choose = resolve;
      }),
    )
    .mockResolvedValueOnce("/font-OFL.txt");
  const props = {
    itemId: "same-item",
    property: "font",
    label: "Font",
    value: "",
    resources: [],
    onValueChange: vi.fn(),
  };
  const view = render(
    <ResourceProperty
      {...props}
      origin={{ sessionId: "old-session", revision: 10 }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import font" }));
  view.rerender(
    <ResourceProperty
      {...props}
      origin={{ sessionId: "reopened-session", revision: 12 }}
    />,
  );
  choose("/font.ttf");
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "import_graphic_resource",
      expect.objectContaining({
        target: {
          itemId: "same-item",
          property: "font",
          sessionId: "old-session",
          expectedRevision: 10,
        },
      }),
    ),
  );
});
