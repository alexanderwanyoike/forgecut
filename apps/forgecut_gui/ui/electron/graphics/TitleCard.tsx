import { useMemo, useState } from "react";
import { loadFont } from "@remotion/fonts";
import { Img, interpolate, useCurrentFrame } from "remotion";

type GraphicValues = Record<string, string | number | boolean | null>;

type ResourceInput = { url: string; sha256: string; mime: string };
export type TitleCardProps = {
  values: GraphicValues;
  resources?: Record<string, ResourceInput>;
  layerStates?: Record<
    string,
    { hidden?: boolean; locked?: boolean; order?: number }
  >;
};
const fontLoads = new Map<string, Promise<void>>();
export function fontFamily(font: ResourceInput): string {
  return `ForgeCut_${font.sha256}`;
}
export function prepareFont(font: ResourceInput): Promise<void> {
  let loading = fontLoads.get(font.sha256);
  if (!loading) {
    let format: "woff2" | "woff" | "opentype" | "truetype" = "truetype";
    if (font.mime === "font/woff2") format = "woff2";
    if (font.mime === "font/woff") format = "woff";
    if (font.mime === "font/otf") format = "opentype";
    loading = loadFont({
      family: fontFamily(font),
      url: font.url,
      format,
      weight: "700",
    }).catch((failure: unknown) => {
      fontLoads.delete(font.sha256);
      throw failure;
    });
    fontLoads.set(font.sha256, loading);
  }
  return loading;
}

export default function TitleCard({
  values,
  resources = {},
  layerStates = {},
}: TitleCardProps) {
  const frame = useCurrentFrame();
  const font =
    typeof values.font === "string" ? resources[values.font] : undefined;
  const image =
    typeof values.image === "string" ? resources[values.image] : undefined;
  const [artworkError, setArtworkError] = useState("");
  const [fontError, setFontError] = useState<{
    hash: string;
    message: string;
  } | null>(null);
  useMemo(() => {
    if (font)
      void prepareFont(font).catch((failure: unknown) =>
        setFontError({
          hash: font.sha256,
          message: failure instanceof Error ? failure.message : String(failure),
        }),
      );
  }, [font]);
  if (values.image && !image)
    throw new Error("The selected artwork resource is unavailable");
  if (image && artworkError === image.sha256)
    throw new Error("Artwork could not load");
  if (values.font && !font)
    throw new Error("The selected font resource is unavailable");
  if (fontError && fontError.hash === font?.sha256)
    throw new Error(fontError.message);
  const entrance =
    values.animation === "none" || numeric(values, "entrance_frames") <= 0
      ? 1
      : interpolate(frame, [0, numeric(values, "entrance_frames")], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  let alignment: "left" | "center" | "right" = "left";
  if (values.alignment === "center" || values.alignment === "right")
    alignment = values.alignment;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: text(values, "background_color"),
          opacity: numeric(values, "background_opacity"),
        }}
      />
      {image &&
        !layerStates["1c1dfd1c-520b-4c83-8a82-b00fdf9b8d90"]?.hidden && (
          <Img
            data-graphic-layer="1c1dfd1c-520b-4c83-8a82-b00fdf9b8d90"
            alt="Artwork"
            src={image.url}
            onError={() => setArtworkError(image.sha256)}
            style={{
              position: "absolute",
              left: numeric(values, "image_x"),
              top: numeric(values, "image_y"),
              width: numeric(values, "image_width"),
              height: numeric(values, "image_height"),
              opacity: numeric(values, "image_opacity"),
              objectFit:
                text(values, "image_fit") === "contain" ? "contain" : "cover",
              zIndex:
                layerStates["1c1dfd1c-520b-4c83-8a82-b00fdf9b8d90"]?.order ?? 0,
            }}
          />
        )}
      <div
        data-graphic-layer="3aa35212-adf2-46b6-b406-2c4b1bb4f93a"
        style={{
          position: "absolute",
          left: numeric(values, "title_x"),
          top: numeric(values, "title_y"),
          width: numeric(values, "title_width"),
          height: numeric(values, "title_height"),
          opacity: numeric(values, "opacity"),
          fontSize: numeric(values, "font_size"),
          display: layerStates["3aa35212-adf2-46b6-b406-2c4b1bb4f93a"]?.hidden
            ? "none"
            : undefined,
          zIndex:
            layerStates["3aa35212-adf2-46b6-b406-2c4b1bb4f93a"]?.order ?? 1,
          fontFamily: font ? fontFamily(font) : "sans-serif",
          fontWeight: 700,
          lineHeight: 1.05,
          color: text(values, "color"),
          textAlign: alignment,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        <div
          style={{
            opacity: entrance,
            transform: `translateY(${values.animation === "rise" ? (1 - entrance) * 20 : 0}px)`,
          }}
        >
          {text(values, "title")}
        </div>
      </div>
    </div>
  );
}

function numeric(values: GraphicValues, key: string): number {
  const value = values[key];
  if (typeof value !== "number")
    throw new Error(`Expected numeric graphic property: ${key}`);
  return value;
}
function text(values: GraphicValues, key: string): string {
  const value = values[key];
  if (typeof value !== "string")
    throw new Error(`Expected text graphic property: ${key}`);
  return value;
}
