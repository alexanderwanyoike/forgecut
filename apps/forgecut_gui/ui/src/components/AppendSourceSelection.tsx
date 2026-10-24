import { ListPlus } from "lucide-react";
import { useState } from "react";
import { projectSequences } from "../../electron/domain/project-sequences";
import { timelineEndUs } from "../../electron/domain/timeline-item";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import type { SourceSelection } from "../../electron/shared/source-selection";
import { invokeInContext } from "../lib/bridge";
import ActionButton from "./ActionButton";

type Props = {
  snapshot: ProjectSnapshot;
  selection: SourceSelection;
};

export default function AppendSourceSelection({ snapshot, selection }: Props) {
  const [trackId, setTrackId] = useState("");
  const [busy, setBusy] = useState(false);
  const sequences = projectSequences(snapshot.project);
  const sequence = sequences.find(
    (value) => value.id === (snapshot.activeSequenceId ?? sequences[0].id),
  );
  const asset = snapshot.project.assets.find(
    (value) => value.id === selection.asset_id,
  );
  const tracks =
    sequence?.timeline.tracks.filter((track) => track.kind === asset?.kind) ??
    [];
  const track = tracks.find((value) => value.id === trackId) ?? tracks[0];
  async function append() {
    if (!track || !sequence || busy) return;
    setBusy(true);
    try {
      await invokeInContext(
        { sessionId: snapshot.sessionId, sequenceId: sequence.id },
        "apply_edits",
        {
          sessionId: snapshot.sessionId,
          sequenceId: sequence.id,
          expectedRevision: snapshot.revision,
          requestId: crypto.randomUUID(),
          operations: [
            {
              command: "add_clip_to_timeline",
              args: {
                assetId: selection.asset_id,
                trackId: track.id,
                sourceInUs: selection.source_in_us,
                sourceOutUs: selection.source_out_us,
                timelineStartUs: track.items.reduce(
                  (end, item) => Math.max(end, timelineEndUs(item)),
                  0,
                ),
              },
            },
          ],
        },
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="source-selection-field">
      <label>
        Append to track
        <select
          value={track?.id ?? ""}
          disabled={busy || !track}
          onChange={(event) => setTrackId(event.currentTarget.value)}
        >
          {!track && (
            <option value="">
              Add a {asset?.kind.toLowerCase()} track first
            </option>
          )}
          {tracks.map((value) => (
            <option key={value.id} value={value.id}>
              {value.kind} {(sequence?.timeline.tracks.indexOf(value) ?? 0) + 1}
            </option>
          ))}
        </select>
      </label>
      <ActionButton
        icon={ListPlus}
        disabled={busy || !track}
        tooltip="Append the saved source range to the end of this track"
        onClick={() => {
          void append().catch(() => {});
        }}
      >
        Append selection
      </ActionButton>
    </div>
  );
}
