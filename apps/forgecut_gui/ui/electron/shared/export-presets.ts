export const EXPORT_PRESET_IDS = ["mp4", "webm"] as const;
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export const EXPORT_PRESETS = {
  mp4: { label: "MP4 / H.264 + AAC", extension: "mp4", quality: "Balanced" },
  webm: { label: "WebM / VP9 + Opus", extension: "webm", quality: "Balanced" },
} as const;
