import { spawn } from "node:child_process";

const base = "/web-clash-royale/";
const origin = "http://127.0.0.1:5189";

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

await run("npm", ["run", "build"], { ...process.env, VITE_BASE_PATH: base });
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "5189",
    "--strictPort",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_BASE_PATH: base },
  },
);
let output = "";
let serverError;
server.on("error", (error) => {
  serverError = error;
});
server.stdout.on("data", (data) => {
  output += data;
});
server.stderr.on("data", (data) => {
  output += data;
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Preview failed: ${output}`);
    if (output.includes(origin)) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Preview did not start: ${output}`);
  await run(process.execPath, ["scripts/check-offline.mjs"], {
    ...process.env,
    ARENA_BASE_URL: `${origin}${base}`,
  });
} finally {
  server.kill();
}
