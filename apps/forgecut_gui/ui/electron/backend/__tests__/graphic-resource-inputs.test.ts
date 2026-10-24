/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { graphicResourceInputs } from "../graphic-inputs";
import { graphicTemplates } from "../graphic-catalog";
import { AppState } from "../state";
import type { GraphicResource } from "../../shared/graphic-resources";
vi.mock("../graphic-resource-store", () => ({
  readGraphicResource: vi
    .fn()
    .mockResolvedValue({ ok: true, value: Buffer.from("owned bytes") }),
}));
it("supplies only property and explicitly declared image/font resources to custom code", async () => {
  const component = graphicTemplates()[0];
  const resource: GraphicResource = {
    id: randomUUID(),
    name: "Declared artwork",
    kind: "Image",
    mime: "image/png",
    sha256: "a".repeat(64),
    path: ".forgecut-resources/" + "a".repeat(64),
    license: { identifier: "Test", text: "Generated fixture" },
  };
  const font: GraphicResource = {
    ...resource,
    id: randomUUID(),
    kind: "Font",
    mime: "font/ttf",
    sha256: "b".repeat(64),
  };
  const other: GraphicResource = { ...resource, id: randomUUID() };
  const project = structuredClone(new AppState().project);
  project.resources = [resource, font, other];
  component.dependencies.assets = [resource.id];
  component.dependencies.fonts = [font.id];
  const inputs = await graphicResourceInputs(project, component, {});
  expect(inputs).toMatchObject({
    ok: true,
    value: {
      [resource.id]: { mime: "image/png" },
      [font.id]: { mime: "font/ttf" },
    },
  });
  if (!inputs.ok) throw new Error(inputs.error.message);
  expect(Object.keys(inputs.value).sort()).toEqual(
    [resource.id, font.id].sort(),
  );
  component.dependencies.assets = [randomUUID()];
  expect(await graphicResourceInputs(project, component, {})).toMatchObject({
    ok: false,
    error: { code: "MISSING_RESOURCE" },
  });
});
