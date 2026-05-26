import { defineConfig } from "vite";
import { createArchitectureStore } from "./src/server/architectureStore";
import { createArchitectureApiMiddleware } from "./src/server/apiMiddleware";

export default defineConfig({
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
