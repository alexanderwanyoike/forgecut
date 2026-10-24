import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GraphicCanvas from "../components/GraphicCanvas";
import AssetBin from "../components/AssetBin";
import { graphicTemplateDefinitions } from "../../electron/domain/graphic-templates";
import { invoke } from "../lib/bridge";
vi.mock("../components/GraphicPreview", () => ({ default: () => null }));
vi.mock("../lib/bridge", () => ({
  invoke: vi.fn().mockResolvedValue({}),
  mediaUrl: (path: string) => path,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("replaces artwork from the bin through a guarded edit and excludes locked hit targets", async () => {
  const component = {
    ...graphicTemplateDefinitions("source")[0],
    version: "0".repeat(64),
  };
  const resource = {
    id: "new-image",
    sha256: "0".repeat(64),
    name: "Ending artwork",
    kind: "Image" as const,
    mime: "image/png" as const,
    relative_path: ".forgecut-resources/hash",
    license: { identifier: "fixture", text: "Fixture" },
  };
  const item = {
    id: "graphic",
    track_id: "graphics",
    timeline_start_us: 0,
    duration_us: 1000000,
    component_id: component.id,
    component_version: component.version,
    props: {
      ...Object.fromEntries(
        Object.entries(component.properties).map(([key, p]) => [
          key,
          p.default,
        ]),
      ),
      image: "previous-image",
    },
  };
  const props = {
    component,
    item,
    resources: [resource],
    settings: { width: 1920, height: 1080, fps: 30 },
    placement: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      fit: "contain" as const,
      opacity: 1,
    },
    frame: 0,
    sessionId: "session",
    revision: 7,
    editable: true,
  };
  const view = render(
    <>
      <AssetBin projectVersion={7} projectAssets={[]} resources={[resource]} />
      <GraphicCanvas {...props} />
    </>,
  );
  const data = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    types: ["application/forgecut-resource"],
  };
  fireEvent.dragStart(
    screen.getByText("Ending artwork").closest("[draggable]")!,
    { dataTransfer },
  );
  fireEvent.drop(screen.getByRole("button", { name: "Select Artwork" }), {
    dataTransfer,
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "apply_edits",
      expect.objectContaining({
        sessionId: "session",
        expectedRevision: 7,
        operations: [
          {
            command: "update_item",
            args: {
              itemId: "graphic",
              patch: {
                kind: "RemotionGraphic",
                changes: { props: { image: "new-image" } },
              },
            },
          },
        ],
      }),
    ),
  );
  view.rerender(
    <GraphicCanvas
      {...props}
      item={{
        ...item,
        layer_states: { [component.layers[0].id]: { locked: true } },
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Select Artwork" })).toBeNull();
});
