import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": {
        target: "http://localhost:8080",
        ws: true,
      },
      "/uploads": "http://localhost:8080",
      "/thumbs": "http://localhost:8080",
      "/avatars": "http://localhost:8080",
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep all strudel/superdough code in a single chunk so the sound
          // registry (nanostores map) is shared between registration and playback
          strudel: [
            "superdough",
            "@strudel/core",
            "@strudel/webaudio",
            "@strudel/mini",
            "@strudel/codemirror",
            "@strudel/transpiler",
          ],
        },
      },
    },
  },
});
