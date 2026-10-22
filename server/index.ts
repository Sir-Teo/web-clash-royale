import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import sirv from "sirv";
import { lanOrigins } from "./lan";
import { attachRooms } from "./rooms";
const assets = sirv("dist", {
  etag: true,
  single: false,
  setHeaders(res, path) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (path.endsWith("sw.js") || path.endsWith("index.html"))
      res.setHeader("Cache-Control", "no-cache");
  },
});
const server = createServer((req, res) => {
  if (req.url === "/api/lan") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ origins: lanOrigins(req.headers.host) }));
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end('{"ok":true}');
    return;
  }
  assets(req, res, () => {
    res.writeHead(404);
    res.end("Not found");
  });
});
attachRooms(server);
const port = Number(process.env.PORT ?? 5173);
server.listen(port, "0.0.0.0", () => {
  console.log(`Browser Arena: http://localhost:${port}`);
  for (const addresses of Object.values(networkInterfaces()))
    for (const a of addresses ?? [])
      if (a.family === "IPv4" && !a.internal)
        console.log(`Wi-Fi: http://${a.address}:${port}`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  });
