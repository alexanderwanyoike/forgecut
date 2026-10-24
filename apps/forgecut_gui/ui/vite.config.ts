import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths: the packaged app loads dist/index.html over file://
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
