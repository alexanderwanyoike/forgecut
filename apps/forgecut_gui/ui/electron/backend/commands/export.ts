import { exportProject } from "../exporter.js";
import { requiredString, type CommandRegistry } from "./types.js";

export const exportCommands = {
  export_project: async (args, { state, webContents }) => {
    const outputPath = requiredString(args, "outputPath");

    await exportProject(state.project, outputPath, {
      onProgress: (progress) => {
        webContents.send("forgecut:event:export-progress", progress);
      },
    });

    webContents.send("forgecut:event:export-complete", { output_path: outputPath });
  },
} satisfies CommandRegistry;
