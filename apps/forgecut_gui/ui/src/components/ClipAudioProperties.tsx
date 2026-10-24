import type {
  AudioSettings,
  ItemPatch,
} from "../../electron/shared/ipc-contract";
import PropertyInput from "./PropertyInput";

type Props = {
  kind: "VideoClip" | "AudioClip";
  settings: AudioSettings;
  update: (patch: ItemPatch) => Promise<void>;
};
export default function ClipAudioProperties({ kind, settings, update }: Props) {
  const change = (changes: AudioSettings) => update({ kind, changes });
  const defaultFade = kind === "AudioClip" ? 100000 : 0;
  return (
    <>
      <label className="inspector-row">
        <span className="inspector-label">Volume</span>
        <input
          className="inspector-slider"
          type="range"
          min="0"
          max="4"
          step="0.01"
          value={settings.volume ?? 1}
          onChange={(event) =>
            change({ volume: Number(event.currentTarget.value) })
          }
        />
      </label>
      <label className="inspector-row">
        <span className="inspector-label">Mute</span>
        <input
          type="checkbox"
          checked={settings.muted ?? false}
          onChange={(event) => change({ muted: event.currentTarget.checked })}
        />
      </label>
      {(
        [
          ["Fade in (s)", "fade_in_us"],
          ["Fade out (s)", "fade_out_us"],
        ] as const
      ).map(([label, property]) => (
        <label className="inspector-row" key={property}>
          <span className="inspector-label">{label}</span>
          <PropertyInput
            type="number"
            min="0"
            step="0.05"
            className="inspector-input-sm"
            value={(settings[property] ?? defaultFade) / 1000000}
            onValueChange={(raw) => {
              if (raw === "") return;
              const seconds = Number(raw);
              if (Number.isFinite(seconds) && seconds >= 0)
                void change({ [property]: Math.round(seconds * 1000000) });
            }}
          />
        </label>
      ))}
    </>
  );
}
