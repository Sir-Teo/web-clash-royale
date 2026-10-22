// Reconstruct first-frame SC display lists as triangulated, texture-mapped SVG.
// The SC scale terms use 1/1024 units; translations and vertices use twips (1/20 px).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
const commit = "7fc7687e6de74690e902543ee4b59f562121e225",
  base = `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/`;
await mkdir("public/assets/scenery", { recursive: true });
function parse(b) {
  let p = 17,
    n = b.readUInt16LE(p);
  p += 2;
  const ids = Array.from({ length: n }, () => {
    const v = b.readUInt16LE(p);
    p += 2;
    return v;
  });
  const names = {};
  for (let i = 0; i < n; i++) {
    const len = b[p++];
    names[b.toString("utf8", p, p + len)] = ids[i];
    p += len;
  }
  const shapes = {},
    clips = {},
    matrices = [],
    textures = [];
  while (p + 5 <= b.length) {
    const tag = b[p],
      len = b.readUInt32LE(p + 1),
      end = p + 5 + len;
    let q = p + 5;
    if (end > b.length) throw new Error("SC range error");
    if (tag === 1 || tag === 24)
      textures.push([b.readUInt16LE(q + 1), b.readUInt16LE(q + 3)]);
    if (tag === 8)
      matrices.push([
        b.readInt32LE(q) / 1024,
        b.readInt32LE(q + 4) / 1024,
        b.readInt32LE(q + 8) / 1024,
        b.readInt32LE(q + 12) / 1024,
        b.readInt32LE(q + 16) / 20,
        b.readInt32LE(q + 20) / 20,
      ]);
    if (tag === 18) {
      const id = b.readUInt16LE(q),
        count = b.readUInt16LE(q + 2);
      q += 6;
      const polygons = [];
      for (let i = 0; i < count; i++) {
        const st = q + 5,
          sz = b.readUInt32LE(q + 1);
        q = st;
        const sheet = b[q++],
          points = b[q++],
          xy = [],
          uv = [];
        for (let j = 0; j < points; j++) {
          xy.push([b.readInt32LE(q) / 20, b.readInt32LE(q + 4) / 20]);
          q += 8;
        }
        for (let j = 0; j < points; j++) {
          uv.push([b.readUInt16LE(q) / 65535, b.readUInt16LE(q + 2) / 65535]);
          q += 4;
        }
        polygons.push({ sheet, xy, uv });
        q = st + sz;
      }
      shapes[id] = polygons;
    }
    if (tag === 12) {
      const id = b.readUInt16LE(q),
        fps = b[q + 2],
        nf = b.readUInt16LE(q + 3),
        count = b.readInt32LE(q + 5);
      q += 9;
      const refs = [];
      for (let i = 0; i < count; i++) {
        refs.push([
          b.readUInt16LE(q),
          b.readUInt16LE(q + 2),
          b.readUInt16LE(q + 4),
        ]);
        q += 6;
      }
      const nc = b.readUInt16LE(q);
      q += 2;
      const children = [];
      for (let i = 0; i < nc; i++) {
        children.push(b.readUInt16LE(q));
        q += 2;
      }
      q += nc;
      for (let i = 0; i < nc; i++) {
        const l = b[q++];
        if (l < 255) q += l;
      }
      const frames = [];
      let offset = 0;
      while (q + 5 <= end) {
        const t = b[q],
          l = b.readUInt32LE(q + 1);
        if (t === 11) {
          const count = b.readUInt16LE(q + 5);
          frames.push(
            refs
              .slice(offset, offset + count)
              .map(([child, mat, color]) => ({
                id: children[child],
                matrix: mat,
                color,
              })),
          );
          offset += count;
        }
        q += 5 + l;
      }
      clips[id] = { fps, nf, frames };
    }
    p = end;
    if (tag === 0) break;
  }
  return { names, shapes, clips, matrices, textures };
}
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m, p) => [
  p[0] * m[0] + p[1] * m[2] + m[4],
  p[0] * m[1] + p[1] * m[3] + m[5],
];
function affine(s, d) {
  const a = s[1][0] - s[0][0],
    b = s[1][1] - s[0][1],
    c = s[2][0] - s[0][0],
    e = s[2][1] - s[0][1],
    det = a * e - b * c;
  if (Math.abs(det) < 1e-6) return null;
  const u = d[1][0] - d[0][0],
    v = d[2][0] - d[0][0],
    w = d[1][1] - d[0][1],
    z = d[2][1] - d[0][1];
  const A = (u * e - v * b) / det,
    C = (v * a - u * c) / det,
    B = (w * e - z * b) / det,
    D = (z * a - w * c) / det;
  return [
    A,
    B,
    C,
    D,
    d[0][0] - A * s[0][0] - C * s[0][1],
    d[0][1] - B * s[0][0] - D * s[0][1],
  ];
}
async function compose(name, exports) {
  const sourceBase = name.startsWith("level_") ? base.replace("1.8.1/com.supercell.clashroyale-1.8.1", "1.8.0/com.supercell.clashroyale_1.8.0_unpack") : base;
  const data = parse(await readFile(`reference/sc/${name}.bin`));
  const textures = [];
  for (let i = 0; i < data.textures.length; i++) {
    const path = `/tmp/browser-royale-sprites/${name}_tex${"_".repeat(i)}.png`;
    let b;
    try {
      b = await readFile(path);
    } catch {
      const r = await fetch(sourceBase + `${name}_tex${"_".repeat(i)}.png`);
      if (!r.ok) throw new Error("Texture import failed");
      b = Buffer.from(await r.arrayBuffer());
      await writeFile(path, b);
    }
    const meta = await sharp(b).metadata();
    textures.push({ b, w: meta.width, h: meta.height });
  }
  for (const [exp, out] of Object.entries(exports)) {
    const tris = [];
    let bounds = [Infinity, Infinity, -Infinity, -Infinity];
    function render(id, m, depth = 0) {
      if (depth > 12) return;
      const shape = data.shapes[id];
      if (shape) {
        for (const p of shape) {
          const tex = textures[p.sheet];
          for (let j = 1; j < p.xy.length - 1; j++) {
            const ds = [p.xy[0], p.xy[j], p.xy[j + 1]].map((v) => apply(m, v));
            const ss = [p.uv[0], p.uv[j], p.uv[j + 1]].map((v) => [
              v[0] * tex.w,
              v[1] * tex.h,
            ]);
            const a = affine(ss, ds);
            if (!a) continue;
            for (const v of ds) {
              bounds[0] = Math.min(bounds[0], v[0]);
              bounds[1] = Math.min(bounds[1], v[1]);
              bounds[2] = Math.max(bounds[2], v[0]);
              bounds[3] = Math.max(bounds[3], v[1]);
            }
            tris.push({
              points: ds.map((p) => p.join(",")).join(" "),
              matrix: a,
              sheet: p.sheet,
            });
          }
        }
      } else {
        for (const child of data.clips[id]?.frames[0] ?? [])
          render(
            child.id,
            multiply(m, data.matrices[child.matrix] ?? [1, 0, 0, 1, 0, 0]),
            depth + 1,
          );
      }
    }
    render(data.names[exp], [1, 0, 0, 1, 0, 0]);
    if (!tris.length) throw new Error(`Empty export ${exp}`);
    const w = Math.ceil(bounds[2] - bounds[0]),
      h = Math.ceil(bounds[3] - bounds[1]);
    const expand = (points) => {
      const p = points.split(" ").map((v) => v.split(",").map(Number));
      const cx = p.reduce((s, v) => s + v[0], 0) / 3,
        cy = p.reduce((s, v) => s + v[1], 0) / 3;
      return p
        .map(([x, y]) => {
          const d = Math.hypot(x - cx, y - cy) || 1;
          return `${x + ((x - cx) / d) * 0.15},${y + ((y - cy) / d) * 0.15}`;
        })
        .join(" ");
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${bounds[0]} ${bounds[1]} ${w} ${h}"><defs>${textures.map((t, i) => `<image id="tex${i}" width="${t.w}" height="${t.h}" xlink:href="data:image/png;base64,${t.b.toString("base64")}"/>`).join("")}${tris.map((t, i) => `<clipPath id="p${i}"><polygon points="${expand(t.points)}"/></clipPath>`).join("")}</defs>${tris.map((t, i) => `<g clip-path="url(#p${i})"><use xlink:href="#tex${t.sheet}" transform="matrix(${t.matrix.join(" ")})"/></g>`).join("")}</svg>`;
    await sharp(Buffer.from(svg), { limitInputPixels: 100000000 })
      .resize({ width: out === "ground" || out === "goblin-ground" ? 1400 : 400 })
      .png()
      .toFile(`public/assets/scenery/${out}.png`);
    console.log(exp, out, w, h, "triangles", tris.length);
    await writeFile(
      `reference/sc/${out}.json`,
      JSON.stringify(
        {
          source: name,
          export: exp,
          bounds,
          width: w,
          height: h,
          triangles: tris.length,
          origin: [-bounds[0] / w, 1 + bounds[1] / h],
        },
        null,
        2,
      ),
    );
  }
}
await compose("arena_training", { training_area_bg: "ground" });
await compose("building_tower", {
  KingTower_blue: "king-blue",
  KingTower_red: "king-red",
  StarTower_base_blue: "princess-base-blue",
  StarTower_base_red: "princess-base-red",
  StarTower_top_blue: "princess-top-blue",
  StarTower_top_red: "princess-top-red",
});
await sharp("public/assets/scenery/ground.png")
  .extract({ left: 538, top: 319, width: 324, height: 463 })
  .resize(810, 1158)
  .png()
  .toFile("public/assets/scenery/battlefield.png");

await compose("chr_balloon",{balloon1_idle1_1:"balloon-blue",balloon1_enemy_idle1_1:"balloon-red"});
await compose("building_basic_cannon",{building_cannon:"cannon-blue",building_enemy_cannon:"cannon-red"});
await compose("building_tesla",{tesla1_blue:"tesla-blue",tesla1_red:"tesla-red"});
await compose("level_goblin_arena",{goblin_bgr:"goblin-ground",goblin_sidestand_left:"goblin-stand-left",goblin_sidestand_right:"goblin-stand-right",goblin_blue_tower:"goblin-tower-blue",goblin_red_tower:"goblin-tower-red",goblin_tree1:"goblin-tree",goblin_waterwheel:"goblin-wheel"});

const goblinSource=parse(await readFile('reference/sc/level_goblin_arena.bin'));
const decoExports=Object.fromEntries(Object.keys(goblinSource.names).filter(name=>name.startsWith('goblin_')&&!['goblin_bgr','goblin_bridge_asset'].includes(name)).map(name=>[name,`deco-${name}`]));
await compose('level_goblin_arena',decoExports);
await sharp('public/assets/scenery/goblin-ground.png').extract({left:531,top:217,width:334,height:465}).resize(810,1128).png().toFile('public/assets/scenery/goblin-field.png');
const placements={};let current='';
for(const line of (await readFile('reference/goblin-arena.csv','utf8')).split(/\r?\n/)){const cells=line.split(',').map(v=>v.replaceAll('"',''));if(cells[1]&&cells[1].startsWith('goblin_'))current=cells[1];if(!cells[0]&&!cells[1]&&cells[2]!==''&&cells[3]!==''&&Number.isFinite(Number(cells[2]))&&Number.isFinite(Number(cells[3]))){const x=Number(cells[2])/1000,y=Number(cells[3])/1000;if(x>=-7&&x<=25&&y>=-6&&y<=38)(placements[current]??=[]).push({x,y});}}
const layout=[];
for(const [name,positions] of Object.entries(placements)){if(!decoExports[name])continue;const data=JSON.parse(await readFile(`reference/sc/deco-${name}.json`,'utf8'));layout.push({name,file:`deco-${name}.png`,width:data.width/30,height:data.height/30,anchor:data.origin,positions});}
await writeFile('public/assets/scenery/goblin-layout.json',JSON.stringify(layout));
