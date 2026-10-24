import { useMemo, useState } from "react";
import { loadFont } from "@remotion/fonts";
import { interpolate, useCurrentFrame } from "remotion";

type GraphicValues = Record<string, string | number | boolean | null>;

type FontResource = { url: string; sha256: string; mime: string };
export type TitleCardProps = {
  values: GraphicValues;
  resources?: Record<string, FontResource>;
};
const fontLoads = new Map<string, Promise<void>>();
export function fontFamily(font: FontResource): string {
  return `ForgeCut_${font.sha256}`;
}
export function prepareFont(font: FontResource): Promise<void> {
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

export default function TitleCard({ values, resources = {} }: TitleCardProps) {
  const frame = useCurrentFrame();
  const font =
    typeof values.font === "string" ? resources[values.font] : undefined;
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
  if (values.font && !font)
    throw new Error("The selected font resource is unavailable");
  if (fontError && fontError.hash === font?.sha256)
    throw new Error(fontError.message);
  const entrance =
    numeric(values, "entrance_frames") <= 0
      ? 1
      : interpolate(frame, [0, numeric(values, "entrance_frames")], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
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
          fontFamily: font ? fontFamily(font) : "sans-serif",
          fontWeight: 700,
          lineHeight: 1.05,
          color: text(values, "color"),
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        <div
          style={{
            opacity: entrance,
            transform: `translateY(${(1 - entrance) * 20}px)`,
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
