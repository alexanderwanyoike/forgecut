export type ResourceLicense = {
  identifier: string;
  text: string;
  attribution?: string;
  source_url?: string;
};
export type GraphicResource = {
  id: string;
  name: string;
  kind: "Image" | "Font";
  mime:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "font/ttf"
    | "font/otf"
    | "font/woff"
    | "font/woff2";
  sha256: string;
  path: string;
  license: ResourceLicense;
};

export type GraphicResourceInput = {
  url: string;
  sha256: string;
  mime: GraphicResource["mime"];
};

export type GraphicResourceImport = { path: string; kind: "Image" | "Font" } & (
  | { license: ResourceLicense; licensePath?: never }
  | { licensePath: string; license?: never }
);
export type GraphicResourceSelection = { itemId: string; property: string };
