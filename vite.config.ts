import { Server } from "node:http";
import { lanOrigins } from "./server/lan";
import { defineConfig } from "vite";
import { attachRooms } from "./server/rooms";
export default defineConfig({
  plugins: [
    {
      name: "arena-multiplayer",
      configureServer(server) {
        server.middlewares.use("/api/lan", (req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ origins: lanOrigins(req.headers.host) }));
        });
        if (server.httpServer instanceof Server) attachRooms(server.httpServer);
      },
    },
  ],
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
});
