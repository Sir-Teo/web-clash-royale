import { networkInterfaces } from "node:os";
export function lanOrigins(host = "") {
  let url: URL;
  try {
    url = new URL(`http://${host || "localhost"}`);
  } catch {
    return [];
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return [];
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a?.family === "IPv4" && !a.internal)
    .map((a) => `http://${a!.address}${url.port ? ":" + url.port : ""}`);
}
