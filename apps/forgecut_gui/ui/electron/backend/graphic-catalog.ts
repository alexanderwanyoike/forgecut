import { readFileSync } from "node:fs";
import { componentVersion } from "./graphic-component.js";
import type { GraphicComponent } from "../shared/graphics.js";

export function graphicTemplates(): GraphicComponent[] {
  const title: Omit<GraphicComponent, "version"> = {
    id: "e105b917-0f43-4139-9199-e5a2c7dca908",
    template_id: "title-card",
    name: "Title card",
    design_size: { width: 1920, height: 1080 },
    dependencies: {
      packages: {
        react: "18.3.1",
        remotion: "4.0.537",
        "@remotion/fonts": "4.0.537",
      },
      assets: [],
      fonts: [],
    },
    source: {
      entry: "main.tsx",
      files: {
        "main.tsx": readFileSync(
          new URL("../graphics/TitleCard.tsx", import.meta.url),
          "utf8",
        ),
      },
    },
    properties: {
      title: {
        id: "49482454-cb0a-5712-b004-f0fda9efc2b3",
        label: "Title",
        type: "text",
        default: "Title",
      },
      font: {
        id: "42bb1cd8-dfb9-4cbd-bb6a-de11b1c7b569",
        label: "Font",
        type: "font",
        default: "",
      },
      color: {
        id: "1df73ef3-8e7d-5112-9846-451af4778997",
        label: "Color",
        type: "color",
        default: "#e6e6e6",
      },
      font_size: {
        id: "b738cd45-beba-50de-9d63-0d6658de4dd7",
        label: "Font size",
        type: "number",
        default: 120,
        min: 1,
        max: 2000,
      },
      title_x: {
        id: "67228480-96e4-5fc7-9459-fb89be218582",
        label: "X",
        type: "number",
        default: 150,
      },
      title_y: {
        id: "b8145070-ad03-575f-b725-8649cb767358",
        label: "Y",
        type: "number",
        default: 420,
      },
      title_width: {
        id: "7213c307-6957-5989-bbde-24902003fedf",
        label: "Width",
        type: "number",
        default: 1620,
        min: 1,
      },
      title_height: {
        id: "a2368a79-abdf-5627-b847-b792fd778f28",
        label: "Height",
        type: "number",
        default: 500,
        min: 1,
      },
      opacity: {
        id: "84d16cca-2410-5d33-ba51-3547b93a27e6",
        label: "Opacity",
        type: "number",
        default: 1,
        min: 0,
        max: 1,
      },
      background_color: {
        id: "c8d7d567-88d5-5667-a3dc-1d076f281285",
        label: "Background",
        type: "color",
        default: "#101418",
      },
      background_opacity: {
        id: "5c2a157d-e861-53dd-9e4f-ddda55f943a9",
        label: "Background opacity",
        type: "number",
        default: 1,
        min: 0,
        max: 1,
      },
      entrance_frames: {
        id: "b39c30e7-225d-5882-8fe8-38380fd123c4",
        label: "Entrance (frames)",
        type: "number",
        default: 12,
        min: 0,
        max: 600,
      },
    },
    layers: [
      {
        id: "3aa35212-adf2-46b6-b406-2c4b1bb4f93a",
        name: "title",
        label: "Title",
        kind: "text",
        bindings: {
          x: "title_x",
          y: "title_y",
          width: "title_width",
          height: "title_height",
          text: "title",
          color: "color",
          font_size: "font_size",
          opacity: "opacity",
        },
      },
    ],
  };
  return [{ ...title, version: componentVersion(title) }];
}
