import type { NativeData } from "./native";

const pending = new Map<string, Promise<HTMLImageElement>>();
const queue: {
  source: string;
  resolve: (image: HTMLImageElement) => void;
  reject: (error: unknown) => void;
}[] = [];
let active = 0;

async function decode(source: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  await image.decode();
  return image;
}

function drain() {
  // All native UI libraries share this budget, including the health atlas.
  while (active < 4 && queue.length) {
    const { source, resolve, reject } = queue.shift()!;
    active++;
    const finish = () => {
      active--;
      pending.delete(source);
      drain();
    };
    void decode(source).then(
      (image) => {
        finish();
        resolve(image);
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  }
}

/** Coalesce in-flight requests without retaining decoded images afterward. */
export function loadNativeImage(source: string): Promise<HTMLImageElement> {
  const existing = pending.get(source);
  if (existing) return existing;
  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    queue.push({ source, resolve, reject });
  });
  pending.set(source, request);
  drain();
  return request;
}

export async function preloadNativeImages(
  data: Pick<NativeData, "shapes">,
  path: string,
) {
  const files = new Set(
    Object.values(data.shapes).flatMap((shape) =>
      (shape.polygons ?? [shape]).flatMap((part) =>
        part.file ? [part.file] : [],
      ),
    ),
  );
  await Promise.all(
    [...files].map((file) => loadNativeImage(`${path}/${file}`)),
  );
}
