import { interpolate, useCurrentFrame } from "remotion";

type GraphicValues = Record<string, string | number | boolean | null>;

export type TitleCardProps = { values: GraphicValues };

export default function TitleCard({ values }: TitleCardProps) {
  const frame = useCurrentFrame();
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
          fontFamily: "sans-serif",
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
