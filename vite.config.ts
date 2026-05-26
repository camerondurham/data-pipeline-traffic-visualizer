import { defineConfig } from "vite";
import { createArchitectureStore } from "./src/server/architectureStore";
import { createArchitectureApiMiddleware } from "./src/server/apiMiddleware";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    {
      name: "architecture-runtime-api",
      async configureServer(server) {
        const store = await createArchitectureStore({ watchFiles: true });
        const apiMiddleware = createArchitectureApiMiddleware(store);
        server.middlewares.use((request, response, next) => {
          void apiMiddleware(request, response, next);
        });
        server.httpServer?.once("close", () => store.close());
      }
    }
  ]
});
