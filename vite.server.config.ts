import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/server/startServer.ts",
    outDir: "dist-server",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "startServer.js"
      }
    }
  }
});
