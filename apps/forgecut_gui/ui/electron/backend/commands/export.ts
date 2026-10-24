import { EditingError } from "../editing-error.js";
import { exportProject } from "../exporter.js";
import { requiredString, type CommandRegistry } from "./types.js";

export const exportCommands = {
  export_project: async (args, { state, emit }) => {
    const outputPath = requiredString(args, "outputPath");

    const result = await exportProject(
      structuredClone(state.project),
      outputPath,
      {
        onProgress: (progress) => {
          emit("export-progress", progress);
        },
      },
    );

    if (!result.ok)
      throw new EditingError(
        result.error.code === "CANCELLED" ? "CANCELLED" : "IO_ERROR",
        result.error.message,
      );
    if (result.value.cleanupWarning) console.warn(result.value.cleanupWarning);
    emit("export-complete", { output_path: outputPath });
  },
} satisfies CommandRegistry;
