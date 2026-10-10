import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local-only dev override (not part of the tracked build config): the
// repo root has a locked ROADMAP.zip that crashes Vite's fs watcher with
// EBUSY on this machine. Same server config as vite.config.ts, plus an
// ignore for that one file.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    proxy: { "/api": process.env.LEE_API_URL ?? "http://127.0.0.1:8787" },
    watch: {
      ignored: ["**/ROADMAP.zip", "**/docs/evidence/**", "**/output/**", "**/test-results/**", "**/visual-report/**"],
    },
  },
});
