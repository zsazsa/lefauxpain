import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

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
      input: {
        main: resolve(__dirname, "index.html"),
        "strudel-sandbox": resolve(__dirname, "strudel-sandbox.html"),
      },
      output: {
        // Keep all strudel/superdough code in a single chunk so the sound
        // registry (nanostores map) is shared between registration and playback.
        // This chunk is only loaded by the sandbox iframe entry point.
        // Function form: the object form is rejected by Vite 8's rolldown bundler.
        manualChunks(id: string) {
          if (/node_modules\/(superdough|@strudel\/(core|webaudio|mini|codemirror|transpiler))\//.test(id)) {
            return "strudel";
          }
          return undefined;
        },
      },
    },
  },
});
