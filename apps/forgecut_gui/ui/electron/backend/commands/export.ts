import { exportProject } from "../exporter.js";
import { requiredString, type CommandRegistry } from "./types.js";

export const exportCommands = {
  export_project: async (args, { state, emit }) => {
    const outputPath = requiredString(args, "outputPath");

    await exportProject(structuredClone(state.project), outputPath, {
      onProgress: (progress) => {
        emit("export-progress", progress);
      },
    });

    emit("export-complete", { output_path: outputPath });
  },
} satisfies CommandRegistry;
