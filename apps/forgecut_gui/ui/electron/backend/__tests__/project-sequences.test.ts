/** @vitest-environment node */
import { expect, it } from "vitest";
import { validateProject } from "../project-schema";

it.each([undefined, 1, 2])(
  "migrates project version %s into one named default sequence without changing its content",
  (version) => {
    const legacy = {
      ...(version ? { schema_version: version } : {}),
      id: "legacy-project",
      name: "Existing trailer",
      settings: { width: 1920, height: 1080, fps: 30, sample_rate: 48000 },
      assets: [],
      timeline: {
        tracks: [
          {
            id: "titles",
            kind: "OverlayText",
            items: [
              {
                TextOverlay: {
                  id: "title",
                  track_id: "titles",
                  timeline_start_us: 1000000,
                  duration_us: 2000000,
                  text: "Original words",
                  font_size: 48,
                  color: "#ffffff",
                  x: 10,
                  y: 20,
                },
              },
            ],
          },
        ],
        markers: [],
      },
    };
    const migrated = validateProject(legacy);
    expect(migrated).toMatchObject({
      schema_version: 3,
      default_sequence: {
        id: expect.stringMatching(/^[a-f\d-]{36}$/),
        name: "Main",
      },
      sequences: [],
    });
    expect(migrated.timeline).toEqual(legacy.timeline);
    expect(migrated.settings).toEqual(legacy.settings);
    expect(migrated.assets).toEqual(legacy.assets);
    expect(validateProject(migrated)).toEqual(migrated);
  },
);
