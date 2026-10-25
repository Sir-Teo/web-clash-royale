import { expect, it } from "vitest";
import {
  renderNativeFrame,
  textureMatrix,
  type NativeData,
  type Shape,
} from "../src/ui/native";

function scene() {
  const polygon: Shape = {
    file: "atlas.png",
    width: 100,
    height: 200,
    xy: [
      [0, 0],
      [10, 0],
      [10, 20],
      [0, 20],
    ],
    uv: [
      [0, 0],
      [100, 0],
      [100, 200],
      [0, 200],
    ],
  };
  const shape = { ...polygon, polygons: [polygon] };
  const data: NativeData = {
    shapes: { 1: shape, 2: shape },
    texts: {
      0: {
        size: 12,
        color: 0xffffffff,
        outlineColor: 0xff000000,
        outlined: false,
        align: 0,
        bounds: [0, 0, 100, 20],
      },
    },
    translations: {},
    audio: {},
    clips: {
      demo: {
        fps: 30,
        frames: [
          [
            {
              shape: 1,
              binding: "first",
              matrix: [1, 0, 0, 1, 0, 0],
              color: [0, 0, 0, 255, 255, 255, 255, 255],
            },
            {
              shape: 2,
              binding: "second",
              matrix: [1, 0, 0, 1, 30, 40],
              color: [16, 0, 0, 128, 128, 255, 255, 255],
            },
            {
              text: 0,
              binding: "label",
              matrix: [1, 0, 0, 1, 0, 0],
              color: [0, 0, 0, 255, 255, 255, 255, 255],
            },
          ],
        ],
      },
    },
  };
  const attributes = new Map<string, string>();
  const host = {
    innerHTML: "",
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
  } as unknown as HTMLElement;
  const render = (
    options: Partial<Parameters<typeof renderNativeFrame>[5]> = {},
    label = "Label",
  ) => {
    renderNativeFrame(
      host,
      data,
      "demo",
      0,
      { label },
      { path: "/art", prefix: "test", viewBox: "0 0 100 100", ...options },
    );
    return host.innerHTML;
  };
  return { data, polygon, host, attributes, render };
}

it("keeps repeated polygons' clips, part transforms and color filters independent", () => {
  const s = scene();
  const markup = s.render({ sliceOverlap: { 1: 0, 2: 0.25 } });
  expect(markup.match(/<image /g)).toHaveLength(2);
  expect(markup).toContain('id="test-shape-0-0"');
  expect(markup).toContain('id="test-shape-1-0"');
  expect(markup).toContain('points="0,0 10,0 10,20 0,20"');
  expect(markup).toContain('points="-0.25,0 10.25,0 10.25,20 -0.25,20"');
  expect(markup).toContain('transform="matrix(1 0 0 1 30 40)"');
  expect(markup).toContain('id="test-tint-1-0"');
  expect(markup).toContain('filter="url(#test-tint-1-0)"');
  expect(markup).not.toContain('id="test-tint-0-0"');
});

it("rebuilds path/prefix bindings and text for each invocation", () => {
  const s = scene();
  s.render({ path: "/first", prefix: "old" }, "Old label");
  const markup = s.render(
    { path: "/second", prefix: "new", bind: true },
    "<Next & label>",
  );
  expect(markup).not.toContain("/first");
  expect(markup).not.toContain("old-shape");
  expect(markup).not.toContain("Old label");
  expect(markup).toContain('href="/second/atlas.png"');
  expect(markup).toContain('id="new-shape-1-0"');
  expect(markup).toContain('data-binding="second"');
  expect(markup).toContain("&lt;Next &amp; label&gt;");
  expect(s.attributes.get("aria-label")).toBe("<Next & label>");
});

it("recomputes texture fitting after in-place geometry changes between frames", () => {
  const s = scene();
  const before = s.render();
  for (const point of s.polygon.xy) point[0] += 12;
  s.polygon.file = "replacement.png";
  const markup = s.render();
  expect(markup).not.toBe(before);
  expect(markup).toContain('href="/art/replacement.png"');
  expect(markup).toContain(
    `transform="matrix(${textureMatrix(s.polygon).join(" ")})"`,
  );
  expect(markup).toContain('points="12,0 22,0 22,20 12,20"');
});

it("does not share fitted geometry between datasets with the same shape IDs", () => {
  const first = scene(),
    second = scene();
  first.render();
  second.polygon.uv = [
    [0, 0],
    [50, 0],
    [50, 100],
    [0, 100],
  ];
  second.polygon.file = "other.png";
  const markup = second.render();
  expect(markup).toContain('href="/art/other.png"');
  expect(markup).toContain(
    `transform="matrix(${textureMatrix(second.polygon).join(" ")})"`,
  );
  expect(markup).not.toContain(
    `transform="matrix(${textureMatrix(first.polygon).join(" ")})"`,
  );
});
