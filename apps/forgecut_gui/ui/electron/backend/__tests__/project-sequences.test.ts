import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
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
      schema_version: 4,
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

it("validates shared media references and item identities across additional sequences", () => {
  const project = structuredClone(new AppState().project);
  project.assets.push({
    id: "recording",
    name: "recording.mp4",
    path: "/private/recording.mp4",
    kind: "Video",
    probe: null,
  });
  project.sequences = [
    {
      id: "b3bc5c73-ec4c-48f3-887a-51f7bb3e5716",
      name: "Standalone clip",
      settings: { ...project.settings, width: 1080, height: 1920 },
      timeline: {
        tracks: [
          {
            id: "video",
            kind: "Video",
            items: [
              {
                VideoClip: {
                  id: "shot",
                  track_id: "video",
                  asset_id: "recording",
                  timeline_start_us: 0,
                  source_in_us: 0,
                  source_out_us: 1000000,
                },
              },
            ],
          },
        ],
        markers: [],
      },
    },
  ];
  expect(validateProject(project).assets).toEqual(project.assets);
  const missing = structuredClone(project);
  const item = missing.sequences![0].timeline.tracks[0].items[0];
  if (!("VideoClip" in item)) throw new Error("Missing clip");
  item.VideoClip.asset_id = "missing";
  expect(() => validateProject(missing)).toThrow("Missing asset reference");
  const duplicate = structuredClone(project);
  duplicate.timeline = structuredClone(project.sequences[0].timeline);
  expect(() => validateProject(duplicate)).toThrow("Duplicate ID");
});

it("saves and reopens sequence names dimensions timelines and stable identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-sequences-"));
  try {
    const state = new AppState();
    state.executeProjectChange((project) => {
      project.default_sequence!.name = "Trailer";
      project.sequences = [
        {
          id: "b3bc5c73-ec4c-48f3-887a-51f7bb3e5716",
          name: "Standalone portrait",
          settings: { ...project.settings, width: 1080, height: 1920, fps: 24 },
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
                      timeline_start_us: 0,
                      duration_us: 1000000,
                      text: "A quiet start",
                      font_size: 48,
                      color: "#ffffff",
                      x: 20,
                      y: 50,
                    },
                  },
                ],
              },
            ],
            markers: [{ time_us: 0, label: "Opening" }],
          },
        },
      ];
    });
    const path = join(directory, "film.forgecut");
    await state.saveProject(path);
    const reopened = new AppState();
    await reopened.loadProject(path);
    expect(reopened.project).toEqual(state.project);
    expect(reopened.canUndo).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("migrates version 3 without replacing default sequence identity or accepting corrupt metadata", () => {
  const current = structuredClone(new AppState().project);
  delete current.source_selections;
  current.schema_version = 3;
  expect(validateProject(current)).toEqual({
    ...current,
    schema_version: 4,
    source_selections: [],
  });
  delete current.default_sequence;
  expect(() => validateProject(current)).toThrow();
});
