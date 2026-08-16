import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist/ui",
  },
  plugins: [preact()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:9080",
    },
  },
  test: {
    environment: "node",
  },
});
