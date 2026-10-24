import type { GraphicComponent } from "../shared/graphics.js";
import type { Result } from "../shared/result.js";

export const graphicDependencyVersions = {
  react: "18.3.1",
  remotion: "4.0.537",
  "@remotion/fonts": "4.0.537",
} as const;
export function validateGraphicDependencies(
  component: GraphicComponent,
): Result<void> {
  const { packages } = component.dependencies;
  if (
    Object.keys(packages).length !==
      Object.keys(graphicDependencyVersions).length ||
    Object.entries(graphicDependencyVersions).some(
      ([name, version]) => packages[name] !== version,
    )
  )
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_DEPENDENCY",
        message:
          "This component declares package versions that the prepared runtime cannot provide",
      },
    };
  return { ok: true, value: undefined };
}
