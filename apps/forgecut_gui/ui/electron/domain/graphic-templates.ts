import { graphicPresets } from "./graphic-presets.js";
import type { GraphicComponent } from "../shared/graphics.js";

export function graphicTemplateDefinitions(
  source: string,
): Omit<GraphicComponent, "version">[] {
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
        "main.tsx": source,
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
      image: {
        id: "6cc88445-e589-44b6-acdf-3b622b63712f",
        label: "Artwork",
        type: "image",
        default: "",
      },
      image_x: {
        id: "8863966c-3cdc-41b8-9bc1-a20ea64f6ada",
        label: "Artwork X",
        type: "number",
        default: 0,
      },
      image_y: {
        id: "f774c04c-34c5-4ab9-b7a6-bbe00113c21b",
        label: "Artwork Y",
        type: "number",
        default: 0,
      },
      image_width: {
        id: "7e30718c-7120-45f0-ac79-45c2df517941",
        label: "Artwork width",
        type: "number",
        default: 1920,
        min: 1,
        max: 16384,
      },
      image_height: {
        id: "2b75d020-adb7-477f-bd8c-ad7815c4d3b9",
        label: "Artwork height",
        type: "number",
        default: 1080,
        min: 1,
        max: 16384,
      },
      image_opacity: {
        id: "fc6a8ea9-b5e3-4347-b710-0c15932ec1d9",
        label: "Artwork opacity",
        type: "number",
        default: 1,
        min: 0,
        max: 1,
      },
      image_fit: {
        id: "0446de2e-44ce-4a69-978b-3157c74e1a13",
        label: "Artwork fit",
        type: "select",
        default: "cover",
        options: [
          { value: "cover", label: "Fill and crop" },
          { value: "contain", label: "Fit inside" },
        ],
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
      alignment: {
        id: "d3213553-2874-43b4-8122-43a8926300e0",
        label: "Alignment",
        type: "select",
        default: "left",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ],
      },
      animation: {
        id: "4f97fae2-89f3-4452-8376-b21d0ad55bf1",
        label: "Animation",
        type: "select",
        default: "rise",
        options: [
          { value: "rise", label: "Rise" },
          { value: "fade", label: "Fade" },
          { value: "none", label: "None" },
        ],
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
        id: "1c1dfd1c-520b-4c83-8a82-b00fdf9b8d90",
        name: "artwork",
        label: "Artwork",
        kind: "image",
        bindings: {
          x: "image_x",
          y: "image_y",
          width: "image_width",
          height: "image_height",
          opacity: "image_opacity",
          image: "image",
          fit: "image_fit",
        },
      },
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
          font: "font",
          alignment: "alignment",
          animation: "animation",
          entrance_frames: "entrance_frames",
          opacity: "opacity",
        },
      },
    ],
  };
  return graphicPresets.map((preset, index) => {
    const component = structuredClone(title);
    component.id = `e105b917-0f43-4139-9199-e5a2c7dca9${(8 + index).toString(16).padStart(2, "0")}`;
    component.template_id = preset.id;
    component.name = preset.label;
    const defaults: Record<string, string | number> = {};
    if (preset.id === "lower-third")
      Object.assign(defaults, {
        title: "Name\nRole",
        title_y: 820,
        title_height: 220,
        font_size: 72,
        background_opacity: 0,
        image_x: 80,
        image_y: 840,
        image_width: 140,
        image_height: 140,
        title_x: 250,
        title_width: 1500,
        image_fit: "contain",
      });
    if (preset.id === "brand-overlay")
      Object.assign(defaults, {
        title: "",
        background_opacity: 0,
        image_x: 1620,
        image_y: 80,
        image_width: 220,
        image_height: 220,
        image_fit: "contain",
        animation: "none",
      });
    if (preset.id === "ending-card")
      Object.assign(defaults, {
        title: "Thanks for watching",
        title_y: 760,
        title_height: 260,
        font_size: 96,
        alignment: "center",
        animation: "fade",
      });
    for (const [key, value] of Object.entries(defaults)) {
      const property = component.properties[key];
      if (property.type === "number" && typeof value === "number")
        property.default = value;
      else if (
        property.type !== "number" &&
        property.type !== "boolean" &&
        typeof value === "string"
      )
        property.default = value;
    }
    return component;
  });
}
