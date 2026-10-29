import type { Texture } from "three";

/** Keep normalized atlas UVs while bounding decoded and GPU texture memory. */
export function textureSize(width: number, height: number, limit: number) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function limitTexture(texture: Texture, limit: number) {
  const image = texture.image as HTMLImageElement;
  if (!image || !Number.isFinite(limit)) return texture;
  const size = textureSize(image.width, image.height, limit);
  if (size.width === image.width && size.height === image.height)
    return texture;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return texture;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
  texture.userData.sourceBytes = image.width * image.height * 4;
  texture.image = canvas;
  texture.needsUpdate = true;
  return texture;
}

/** Bound simultaneous image decodes; callers retain their original atlas indexes. */
export async function loadLimited<T>(
  items: readonly T[],
  limit: number,
  visit: (item: T, index: number) => Promise<void>,
) {
  if (!(limit >= 1)) throw new RangeError("Invalid asset loading limit");
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(items.length, Math.floor(limit)) },
      async () => {
        while (next < items.length) {
          const index = next++;
          await visit(items[index], index);
        }
      },
    ),
  );
}
