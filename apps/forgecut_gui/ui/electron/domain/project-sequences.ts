import type { Project, ProjectSequence } from "../shared/ipc-contract.js";
import type { Result } from "../shared/result.js";

export function projectSequences(project: Project): ProjectSequence[] {
  const main = project.default_sequence ?? { id: project.id, name: "Main" };
  return [
    { ...main, settings: project.settings, timeline: project.timeline },
    ...(project.sequences ?? []),
  ];
}
export function findProjectSequence(
  project: Project,
  sequenceId: string,
): Result<ProjectSequence, { code: "NOT_FOUND"; message: string }> {
  const sequence = projectSequences(project).find(
    (value) => value.id === sequenceId,
  );
  return sequence
    ? { ok: true, value: sequence }
    : {
        ok: false,
        error: { code: "NOT_FOUND", message: "Sequence not found" },
      };
}
