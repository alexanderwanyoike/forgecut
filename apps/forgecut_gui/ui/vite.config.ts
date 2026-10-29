import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative chunks share the packaged editor's secure application origin.
  base: "./",
  plugins: [react()],
  optimizeDeps: {
    include: ["@remotion/player", "@remotion/fonts", "remotion"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "esnext",
  },
});
