import { readFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile("public/app-icon.svg");
for (const size of [180, 192, 512]) {
  await sharp(source, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(`public/app-icon-${size}.png`);
}
const regular = await sharp(source, { density: 300 }).resize(512, 512).png().toBuffer();
await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: "#142948",
  },
}).composite([{ input: regular }]).png().toFile("public/app-icon-maskable-512.png");
console.log("Generated touch, browser and maskable app icons.");
