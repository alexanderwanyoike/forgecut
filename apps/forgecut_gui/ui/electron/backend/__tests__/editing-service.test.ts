/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppState, type Asset } from "../state";
import { EditingService } from "../editing-service";
import { importAsset } from "../media-probe";
import { extractThumbnailsBase64 } from "../media-derived";
import type { EditRequest } from "../../shared/ipc-contract";

vi.mock("../media-probe", () => ({ importAsset: vi.fn() }));
vi.mock("../media-derived", () => ({ extractThumbnailsBase64: vi.fn(), extractWaveform: vi.fn() }));

const asset: Asset = {
  id: "video", name: "film.mp4", path: "/film.mp4", kind: "Video",
  probe: { duration_us: 10_000_000, width: 1920, height: 1080, fps: 30, codec: "h264", audio_channels: 2, audio_sample_rate: 48000 },
};
function setup() {
  const state = new AppState();
  state.executeProjectChange((project) => { project.assets.push(asset); });
  state.initDefaultTracks();
  return { state, service: new EditingService(state) };
}
function request(state: AppState, operations: EditRequest["operations"], requestId = "edit"): EditRequest {
  return { sessionId: state.sessionId, expectedRevision: state.revision, requestId, operations };
}
beforeEach(() => { vi.mocked(importAsset).mockReset(); vi.mocked(extractThumbnailsBase64).mockReset(); });

describe("transport-independent editing service", () => {
  it("commits a batch once, rejects stale revisions, and permits a refreshed retry", async () => {
    const { state, service } = setup();
    const changed = vi.fn(); state.subscribe(changed);
    const edit = request(state, [
      { command: "update_project", args: { name: "Film", settings: { fps: 24 } } },
      { command: "add_track", args: { kind: "OverlayText" } },
    ]);
    expect((await service.execute("apply_edits", edit)).ok).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(state.revision).toBe(edit.expectedRevision + 1);
    expect(await service.execute("apply_edits", { ...edit, requestId: "stale" })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect((await service.execute("apply_edits", { ...edit, requestId: "retry", expectedRevision: state.revision })).ok).toBe(true);
    state.undo(); state.undo();
    expect(state.project.name).toBe("Untitled");
    expect(state.project.settings.fps).toBe(30);
  });

  it("deduplicates retries and rejects a reused request ID with changed contents", async () => {
    const { state, service } = setup();
    const edit = request(state, [{ command: "update_project", args: { settings: { width: 1280, height: 720 }, name: "Film" } }]);
    const first = await service.execute("apply_edits", edit);
    expect(await service.execute("apply_edits", edit)).toEqual(first);
    expect(await service.execute("apply_edits", { ...edit, operations: [{ command: "update_project", args: { name: "Film", settings: { height: 720, width: 1280 } } }] })).toEqual(first);
    expect(state.revision).toBe(edit.expectedRevision + 1);
    expect(await service.execute("apply_edits", { ...edit, operations: [{ command: "add_track", args: { kind: "Audio" } }] })).toMatchObject({ ok: false, error: { code: "REQUEST_REUSED" } });
    const oldSession = state.sessionId;
    state.createProject();
    expect(state.sessionId).not.toBe(oldSession);
    expect(await service.execute("apply_edits", edit)).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
  });

  it("discards a batch that fails midway, including its history and notifications", async () => {
    const { state, service } = setup();
    const before = state.snapshot();
    const changed = vi.fn(); state.subscribe(changed);
    const result = await service.execute("apply_edits", request(state, [
      { command: "update_project", args: { name: "Partial" } },
      { command: "move_clip", args: { itemId: "missing", newStartUs: 0 } },
    ]));
    expect(result.ok).toBe(false);
    expect(state.snapshot()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it("validates source bounds, track compatibility and referenced asset deletion", async () => {
    const { state, service } = setup();
    const videoTrack = state.project.timeline.tracks[0].id;
    const audioTrack = state.project.timeline.tracks[1].id;
    expect((await service.execute("add_clip_to_timeline", { assetId: asset.id, trackId: audioTrack, timelineStartUs: 0 })).ok).toBe(false);
    await service.execute("add_clip_to_timeline", { assetId: asset.id, trackId: videoTrack, timelineStartUs: 0 });
    const clip = state.project.timeline.tracks[0].items[0];
    if (!("VideoClip" in clip)) throw new Error("fixture");
    const before = state.snapshot();
    expect((await service.execute("trim_clip", { itemId: clip.VideoClip.id, trimType: "out", newUs: 11_000_000 })).ok).toBe(false);
    expect((await service.execute("remove_asset", { id: asset.id })).ok).toBe(false);
    expect(state.snapshot()).toEqual(before);
  });

  it.each([
    ["move_clip", { itemId: "clip", newStartUs: NaN }],
    ["move_clip", { itemId: "clip", newStartUs: -1 }],
    ["trim_clip", { itemId: "clip", trimType: "other", newUs: 1 }],
    ["update_item", { itemId: "clip", patch: { kind: "TextOverlay", changes: { id: "replacement" } } }],
    ["update_item", { itemId: "clip", patch: { kind: "TextOverlay", changes: { font_size: Infinity } } }],
    ["update_item", { itemId: "clip", patch: { kind: "ImageOverlay", changes: { opacity: 2 } } }],
    ["update_project", { settings: { fps: 0 } }],
    ["__proto__", {}],
  ])("rejects invalid %s input without changing state", async (command, args) => {
    const { state, service } = setup();
    const before = state.snapshot();
    expect((await service.execute(command, args)).ok).toBe(false);
    expect(state.snapshot()).toEqual(before);
  });

  it("groups a text editing session into one undo entry", async () => {
    const { state, service } = setup();
    await service.execute("add_text_overlay", { trackId: "text", timelineStartUs: 0, durationUs: 1_000_000, text: "Title", fontSize: 48, color: "#ffffff", x: 0, y: 0 });
    const overlay = state.project.timeline.tracks[2].items[0];
    if (!("TextOverlay" in overlay)) throw new Error("fixture");
    for (const text of ["a", "ab", "abc"]) {
      await service.execute("update_item", { itemId: overlay.TextOverlay.id, patch: { kind: "TextOverlay", changes: { text } } }, { editGroup: "typing" });
    }
    state.undo();
    expect(state.project.timeline.tracks[2].items[0]).toEqual(overlay);
  });
});

describe("asynchronous media transactions", () => {
  it("accepts thumbnails across unrelated edits but discards results for changed media", async () => {
    const { state, service } = setup();
    let finish!: (value: []) => void;
    vi.mocked(extractThumbnailsBase64).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = service.execute("get_clip_thumbnails", { assetId: asset.id });
    state.executeProjectChange((project) => { project.name = "New title"; });
    finish([]);
    expect((await first).ok).toBe(true);
    const second = service.execute("get_clip_thumbnails", { assetId: asset.id });
    state.executeProjectChange((project) => { project.assets[0].path = "/replacement.mp4"; });
    finish([]);
    expect(await second).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("imports all assets as one undoable change and leaves no partial import on failure", async () => {
    const state = new AppState(); const service = new EditingService(state);
    vi.mocked(importAsset).mockResolvedValueOnce(asset).mockRejectedValueOnce(new Error("bad file"));
    const before = state.snapshot();
    expect((await service.execute("import_assets", { paths: ["/film.mp4", "/bad"] })).ok).toBe(false);
    expect(state.snapshot()).toEqual(before);
    vi.mocked(importAsset).mockResolvedValue(asset);
    expect((await service.execute("import_assets", { paths: ["/film.mp4"] })).ok).toBe(true);
    state.undo(); expect(state.project.assets).toEqual([]);
    state.redo(); expect(state.project.assets).toEqual([asset]);
  });

  it("rejects a completed import if the project was switched while probing", async () => {
    const state = new AppState(); const service = new EditingService(state);
    let finish!: (asset: Asset) => void;
    vi.mocked(importAsset).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const importing = service.execute("import_assets", { paths: ["/film.mp4"] });
    state.createProject();
    const fresh = state.snapshot();
    finish(asset);
    expect(await importing).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
    expect(state.snapshot()).toEqual(fresh);
  });
});
