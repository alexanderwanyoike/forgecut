import { projectSequences } from "../domain/project-sequences.js";
import type { Project } from "../shared/ipc-contract.js";
import { itemData } from "./timeline-ops.js";

export function changedItemIds(before: Project, after: Project): string[] {
  const items = (project: Project) =>
    new Map(
      projectSequences(project)
        .flatMap((sequence) => sequence.timeline.tracks)
        .flatMap((track) =>
          track.items.map(
            (item) => [itemData(item).id, JSON.stringify(item)] as const,
          ),
        ),
    );
  const previous = items(before);
  const current = items(after);
  return [...new Set([...previous.keys(), ...current.keys()])].filter(
    (id) => previous.get(id) !== current.get(id),
  );
}
