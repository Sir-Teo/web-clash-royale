type Matrix = number[];
export interface TextStyle {
  size: number;
  color: number;
  outlineColor: number;
  outlined: boolean;
  align: number;
  bounds: number[];
}
export interface Part {
  text?: number;
  binding?: string;
  shape?: number;
  matrix: Matrix;
  color: number[];
}
export interface Shape {
  solid?: number;
  polygons?: Shape[];
  file: string;
  width: number;
  height: number;
  xy: number[][];
  uv: number[][];
}
export interface NativeData {
  clips: Record<
    string,
    { fps: number; frames: Part[][]; labels?: Record<string, number> }
  >;
  texts: Record<number, TextStyle>;
  translations: Record<string, string>;
  shapes: Record<number, Shape>;
  audio: Record<string, { file: string; volume: number }>;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const matrix = (m: Matrix) => `matrix(${m.join(" ")})`;
function color(value: number, transform: number[]) {
  const rgb = [(value >>> 16) & 255, (value >>> 8) & 255, value & 255].map(
    (c, i) =>
      Math.min(255, Math.round((c * transform[4 + i]) / 255 + transform[i])),
  );
  return `rgba(${rgb.join(",")},${(value >>> 24) / 255})`;
}
export function textureMatrix(shape: Pick<Shape, "uv" | "xy">): Matrix {
  // Source positions are quantized independently of UVs. Fit the complete
  // polygon so rounding at three vertices does not skew the remaining image.
  const mean = (points: number[][]) =>
    points.reduce(
      (sum, p) => [
        sum[0] + p[0] / points.length,
        sum[1] + p[1] / points.length,
      ],
      [0, 0],
    );
  const [u, v] = mean(shape.uv),
    [x, y] = mean(shape.xy);
  let uu = 0,
    uv = 0,
    vv = 0,
    ux = 0,
    vx = 0,
    uy = 0,
    vy = 0;
  shape.uv.forEach(([a, b], i) => {
    a -= u;
    b -= v;
    const c = shape.xy[i][0] - x,
      d = shape.xy[i][1] - y;
    uu += a * a;
    uv += a * b;
    vv += b * b;
    ux += a * c;
    vx += b * c;
    uy += a * d;
    vy += b * d;
  });
  const det = uu * vv - uv * uv;
  const a = (ux * vv - vx * uv) / det,
    c = (vx * uu - ux * uv) / det;
  const b = (uy * vv - vy * uv) / det,
    d = (vy * uu - uy * uv) / det;
  return [a, b, c, d, x - a * u - c * v, y - b * u - d * v];
}

let measure: CanvasRenderingContext2D | null = null;
const measured = new Map<string, number>();
function fitText(text: string, style: TextStyle, font = '"Supercell Magic"') {
  const key = `${font}:${style.size}:${text}`;
  let width = measured.get(key);
  if (width === undefined) {
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return "";
    measure.font = `${style.size}px ${font}`;
    width = measure.measureText(text).width;
    if (measured.size > 128) measured.clear();
    measured.set(key, width);
  }
  const available = style.bounds[2] - style.bounds[0] - 6;
  return width > available
    ? ` textLength="${available}" lengthAdjust="spacingAndGlyphs"`
    : "";
}
export function renderNativeFrame(
  host: HTMLElement,
  data: NativeData,
  name: string,
  frame: number,
  overrides: Record<string, string>,
  options: {
    path: string;
    viewBox: string;
    prefix: string;
    fit?: boolean;
    omit?: string[];
    bind?: boolean;
    transform?: string;
    font?: string;
    stretch?: boolean;
    /** Horizontal clip overlap for rectangular atlas slices, in source units. */
    sliceOverlap?: Record<number, number>;
  },
) {
  const labels: string[] = [];
  const content = data.clips[name].frames[frame]
    .map((part, index) => {
      if (part.color[3] === 0 || options.omit?.includes(part.binding!))
        return "";
      if (part.text !== undefined) {
        const style = data.texts[part.text];
        const text =
          overrides[part.binding!] ?? data.translations[part.binding!] ?? "";
        if (!text) return "";
        if (part.color[3] > 0) labels.push(text);
        const [left, top, right] = style.bounds,
          align = style.align & 3;
        const x = align === 1 ? right : align === 2 ? (left + right) / 2 : left;
        const family = options.font
          ? ` font-family="${escape(options.font)}"`
          : "";
        return `<g transform="${matrix(part.matrix)}" opacity="${part.color[3] / 255}"><text${family} x="${x}" y="${top}" text-anchor="${align === 1 ? "end" : align === 2 ? "middle" : "start"}" dominant-baseline="text-before-edge" font-size="${style.size}" fill="${color(style.color, part.color)}" stroke="${style.outlined ? color(style.outlineColor, part.color) : "none"}" stroke-width="${Math.max(2, style.size / 18)}" stroke-linejoin="round" paint-order="stroke fill"${options.fit ? fitText(text, style, options.font) : ""}>${escape(text)}</text></g>`;
      }
      const shape = data.shapes[part.shape!];
      const pieces = (shape.polygons ?? [shape])
        .map((polygon, p) => {
          const overlap = options.sliceOverlap?.[part.shape!] ?? 0;
          const center =
            polygon.xy.reduce((sum, p) => sum + p[0], 0) / polygon.xy.length;
          const points = polygon.xy
            .map(([x, y]) => [x + Math.sign(x - center) * overlap, y].join(","))
            .join(" ");
          if (polygon.solid !== undefined)
            return `<polygon points="${points}" fill="${color(polygon.solid, part.color)}" opacity="${part.color[3] / 255}"/>`;
          const clip = `${options.prefix}-shape-${index}-${p}`,
            filter = `${options.prefix}-tint-${index}-${p}`;
          const image = `<image href="${options.path}/${polygon.file}" width="${polygon.width}" height="${polygon.height}" transform="${matrix(textureMatrix(polygon))}"/>`;
          if (
            part.color.slice(0, 3).every((n) => n === 0) &&
            part.color.slice(4).every((n) => n === 255)
          )
            return `<defs><clipPath id="${clip}"><polygon points="${points}"/></clipPath></defs><g clip-path="url(#${clip})" opacity="${part.color[3] / 255}">${image}</g>`;
          return `<defs><clipPath id="${clip}"><polygon points="${points}"/></clipPath><filter id="${filter}" color-interpolation-filters="sRGB"><feComponentTransfer>${["R", "G", "B"].map((channel, i) => `<feFunc${channel} type="linear" slope="${part.color[4 + i] / 255}" intercept="${part.color[i] / 255}"/>`).join("")}<feFuncA type="linear" slope="${part.color[3] / 255}"/></feComponentTransfer></filter></defs><g clip-path="url(#${clip})" filter="url(#${filter})"><image href="${options.path}/${polygon.file}" width="${polygon.width}" height="${polygon.height}" transform="${matrix(textureMatrix(polygon))}"/></g>`;
        })
        .join("");
      return `<g transform="${matrix(part.matrix)}">${pieces}</g>`;
    })
    .map((markup, index) =>
      options.bind && markup
        ? `<g data-binding="${escape(data.clips[name].frames[frame][index].binding ?? "")}">${markup}</g>`
        : markup,
    )
    .join("");
  host.innerHTML = `<svg viewBox="${options.viewBox}" aria-hidden="true"${options.stretch ? ' preserveAspectRatio="none"' : ""}>${options.transform ? `<g transform="${options.transform}">${content}</g>` : content}</svg>`;
  host.setAttribute("aria-label", labels.join(" ") || "Battle introduction");
}
