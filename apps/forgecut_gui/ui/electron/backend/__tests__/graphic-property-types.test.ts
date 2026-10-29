/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { graphicTemplates } from "../graphic-catalog";
it("checks typed component properties against the supplied schema in the isolated compiler", async () => {
  const service = new EditingService(new AppState());
  const properties = graphicTemplates()[0].properties;
  const source = {
    entry: "main.tsx",
    files: {
      "main.tsx":
        "export default function Card({values}:ForgeCut.Props){return <div style={{color:values.color,left:values.title_x}}>{values.title}</div>}",
    },
  };
  expect(
    await service.execute("check_graphic_source", { source, properties }),
  ).toMatchObject({
    ok: true,
    value: { ok: true, value: { code: expect.any(String) } },
  });
  source.files["main.tsx"] =
    "export default function Card({values}:ForgeCut.Props){return <div>{values.title.toFixed(2)}</div>}";
  expect(
    await service.execute("check_graphic_source", { source, properties }),
  ).toMatchObject({
    ok: true,
    value: {
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            file: "main.tsx",
            line: 1,
            message: expect.stringContaining("toFixed"),
          }),
        ]),
      },
    },
  });
  await service.jobs.close();
  await service.closePreviews();
}, 15000);
