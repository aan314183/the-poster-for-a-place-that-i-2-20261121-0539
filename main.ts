// VELMORA — a travel poster for a floating lantern city above the clouds.
// A software rasterizer: 2x supersampled RGB buffer, downsampled, hand-encoded PNG.
// Node 22+, stdlib only. Deterministic: one seeded PRNG, no network, no clock.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 2;
const SW = W * SS;
const SH = H * SS;

type RGB = [number, number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261121);

const buf = new Uint8Array(SW * SH * 3);

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  if (a >= 1) { setPx(x, y, c); return; }
  const i = (y * SW + x) * 3;
  buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Vertical gradient over the whole canvas from colour stops [pos, hex].
function gradient(stops: Array<[number, string]>): void {
  const parsed = stops.map(([p, h]) => [p, hex(h)] as [number, RGB]);
  for (let y = 0; y < SH; y++) {
    const t = y / (SH - 1);
    let k = 0;
    while (k < parsed.length - 2 && t > parsed[k + 1][0]) k++;
    const [p0, c0] = parsed[k];
    const [p1, c1] = parsed[k + 1];
    const f = p1 === p0 ? 0 : Math.min(1, Math.max(0, (t - p0) / (p1 - p0)));
    const c = lerp(c0, c1, f);
    for (let x = 0; x < SW; x++) setPx(x, y, c);
  }
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  const ax = Math.max(0, Math.floor(x0 * SS));
  const bx = Math.min(SW - 1, Math.ceil(x1 * SS));
  const ay = Math.max(0, Math.floor(y0 * SS));
  const by = Math.min(SH - 1, Math.ceil(y1 * SS));
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) blendPx(x, y, c, a);
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const rr = r * SS;
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + r) * SS));
  const ccx = cx * SS; const ccy = cy * SS;
  for (let y = y0; y <= y1; y++) {
    const dy = (y - ccy) / rr;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - ccx) / rr;
      if (dx * dx + dy * dy <= 1) blendPx(x, y, c, a);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor((cx - rx) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + rx) * SS));
  const y0 = Math.max(0, Math.floor((cy - ry) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + ry) * SS));
  const ccx = cx * SS; const ccy = cy * SS;
  const ax = rx * SS; const ay = ry * SS;
  for (let y = y0; y <= y1; y++) {
    const dy = (y - ccy) / ay;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - ccx) / ax;
      if (dx * dx + dy * dy <= 1) blendPx(x, y, c, a);
    }
  }
}

// Soft radial glow with quadratic falloff.
function glow(cx: number, cy: number, r: number, c: RGB, peak: number): void {
  const rr = r * SS;
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + r) * SS));
  const ccx = cx * SS; const ccy = cy * SS;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - ccx, y - ccy) / rr;
      if (d < 1) {
        const f = 1 - d;
        blendPx(x, y, c, peak * f * f);
      }
    }
  }
}

// Scanline-filled polygon; points in 1x poster coordinates.
function fillPolygon(pts: Array<[number, number]>, c: RGB, a = 1): void {
  const scaled = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  let minY = SH; let maxY = 0;
  for (const [, y] of scaled) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(SH - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < scaled.length; i++) {
      const [x1, y1] = scaled[i];
      const [x2, y2] = scaled[(i + 1) % scaled.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(SW - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) blendPx(x, y, c, a);
    }
  }
}

// Thick stroked line with round caps, by stamping discs along the segment.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const dx = (x1 - x0) * SS; const dy = (y1 - y0) * SS;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  const r = (w * SS) / 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 * SS + dx * t;
    const cy = y0 * SS + dy * t;
    const x0b = Math.max(0, Math.floor(cx - r));
    const x1b = Math.min(SW - 1, Math.ceil(cx + r));
    const y0b = Math.max(0, Math.floor(cy - r));
    const y1b = Math.min(SH - 1, Math.ceil(cy + r));
    for (let y = y0b; y <= y1b; y++)
      for (let x = x0b; x <= x1b; x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) blendPx(x, y, c, a);
  }
}

function polyline(pts: Array<[number, number]>, w: number, c: RGB, a = 1): void {
  for (let i = 0; i + 1 < pts.length; i++)
    thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c, a);
}

// ---- Stroke font: geometric single-stroke capitals on a 12 x 16 grid ----
type Glyph = Array<Array<[number, number]>>;
const GLYPHS: Record<string, Glyph> = {
  A: [[[1, 16], [6, 0], [11, 16]], [[3.5, 10], [8.5, 10]]],
  B: [[[1, 0], [1, 16]], [[1, 0], [8, 0], [10, 2], [10, 6], [8, 8], [1, 8]], [[1, 8], [8, 8], [10, 10], [10, 14], [8, 16], [1, 16]]],
  C: [[[10, 2], [8, 0], [3, 0], [1, 2], [1, 14], [3, 16], [8, 16], [10, 14]]],
  D: [[[1, 0], [1, 16]], [[1, 0], [8, 0], [11, 3], [11, 13], [8, 16], [1, 16]]],
  E: [[[11, 0], [1, 0], [1, 16], [11, 16]], [[1, 8], [8, 8]]],
  F: [[[1, 0], [11, 0], [1, 16]], [[1, 8], [8, 8]]],
  G: [[[10, 2], [8, 0], [3, 0], [1, 2], [1, 14], [3, 16], [8, 16], [10, 14], [10, 9], [6, 9]]],
  H: [[[1, 0], [1, 16]], [[11, 0], [11, 16]], [[1, 8], [11, 8]]],
  I: [[[6, 0], [6, 16]], [[2, 0], [10, 0]], [[2, 16], [10, 16]]],
  J: [[[11, 0], [11, 13], [9, 16], [4, 16], [2, 14]]],
  K: [[[1, 0], [1, 16]], [[10, 0], [1, 8], [11, 16]]],
  L: [[[1, 0], [1, 16], [11, 16]]],
  M: [[[1, 16], [1, 0], [6, 10], [11, 0], [11, 16]]],
  N: [[[1, 16], [1, 0], [11, 16], [11, 0]]],
  O: [[[3, 0], [9, 0], [11, 3], [11, 13], [9, 16], [3, 16], [1, 13], [1, 3], [3, 0]]],
  P: [[[1, 16], [1, 0], [9, 0], [11, 2], [11, 6], [9, 8], [1, 8]]],
  Q: [[[3, 0], [9, 0], [11, 3], [11, 13], [9, 16], [3, 16], [1, 13], [1, 3], [3, 0]], [[7, 11], [12, 16]]],
  R: [[[1, 16], [1, 0], [9, 0], [11, 2], [11, 6], [9, 8], [1, 8]], [[8, 8], [11, 16]]],
  S: [[[10, 2], [8, 0], [4, 0], [2, 2], [2, 6], [4, 8], [8, 8], [10, 10], [10, 14], [8, 16], [4, 16], [2, 14]]],
  T: [[[1, 0], [11, 0]], [[6, 0], [6, 16]]],
  U: [[[1, 0], [1, 12], [3, 16], [9, 16], [11, 12], [11, 0]]],
  V: [[[1, 0], [6, 16], [11, 0]]],
  W: [[[1, 0], [3, 16], [6, 8], [9, 16], [11, 0]]],
  X: [[[1, 0], [11, 16]], [[11, 0], [1, 16]]],
  Y: [[[1, 0], [6, 8], [11, 0]], [[6, 8], [6, 16]]],
  Z: [[[1, 0], [11, 0], [1, 16], [11, 16]]],
  " ": [],
};

function drawText(text: string, cx: number, y: number, capH: number, spacing: number, strokeW: number, c: RGB): void {
  const adv = capH * (12 / 16);
  const total = text.length * adv + (text.length - 1) * spacing;
  let x = cx - total / 2;
  const s = capH / 16;
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? [];
    for (const line of glyph) {
      const pts = line.map(([gx, gy]) => [x + gx * s, y + gy * s] as [number, number]);
      polyline(pts, strokeW, c);
    }
    x += adv + spacing;
  }
}

// ---- PNG encoding (hand-rolled, zlib deflate level 9) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  // Downsample 2x2 blocks from the supersampled buffer.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      let r = 0; let g = 0; let b = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y * 2 + dy) * SW + (x * 2 + dx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.round(r / 4); raw[o + 1] = Math.round(g / 4); raw[o + 2] = Math.round(b / 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function validatePng(png: Buffer): void {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(sig)) throw new Error("bad PNG signature");
  if (png.length > 1048576) throw new Error("PNG over 1 MiB: " + png.length);
  if (png.readUInt32BE(16) > 1024 || png.readUInt32BE(20) > 1024) throw new Error("PNG over 1024x1024");
  if (png[24] !== 8) throw new Error("bit depth is not 8");
  if (png[25] !== 2) throw new Error("colour type is not 2");
  if (!png.subarray(png.length - 12).equals(chunk("IEND", Buffer.alloc(0)))) throw new Error("IEND missing");
}

// ---- Scene helpers ----
function lantern(cx: number, cy: number, r: number, body: string, glowR: number): void {
  glow(cx, cy, glowR, hex("#ffb347"), 0.55);
  fillEllipse(cx, cy, r, r * 1.15, hex(body));
  fillEllipse(cx, cy, r * 0.45, r * 0.6, hex("#ffe9b8"));
  fillRect(cx - r * 0.7, cy - r * 1.45, cx + r * 0.7, cy - r * 1.05, hex("#5a3040"));
  fillRect(cx - r * 0.45, cy + r * 1.05, cx + r * 0.45, cy + r * 1.3, hex("#5a3040"));
  thickLine(cx, cy - r * 1.45, cx, cy - r * 1.45 - 7, 1.2, hex("#3a2438"));
}

function house(x: number, y: number, w: number, h: number, wall: string, roof: string): void {
  fillRect(x, y, x + w, y + h, hex(wall));
  fillPolygon([[x - 6, y], [x + w / 2, y - h * 0.55], [x + w + 6, y]], hex(roof));
  fillRect(x + w * 0.18, y + h * 0.42, x + w * 0.38, y + h * 0.68, hex("#ffb347"));
  fillRect(x + w * 0.62, y + h * 0.42, x + w * 0.82, y + h * 0.68, hex("#ffb347"));
  fillRect(x + w * 0.44, y + h * 0.62, x + w * 0.58, y + h, hex("#3a2438"));
  glow(x + w * 0.28, y + h * 0.55, 14, hex("#ffb347"), 0.35);
}

function tree(cx: number, gy: number, trunkH: number, canopyR: number): void {
  fillRect(cx - 3, gy - trunkH, cx + 3, gy, hex("#4a3428"));
  fillCircle(cx, gy - trunkH - canopyR * 0.55, canopyR, hex("#4d7a44"));
  fillCircle(cx - canopyR * 0.55, gy - trunkH - canopyR * 0.2, canopyR * 0.7, hex("#5d8a4e"));
  fillCircle(cx + canopyR * 0.55, gy - trunkH - canopyR * 0.2, canopyR * 0.7, hex("#6f9a55"));
}

function pine(cx: number, gy: number, h: number): void {
  fillRect(cx - 3, gy - 8, cx + 3, gy, hex("#4a3428"));
  fillPolygon([[cx, gy - h], [cx - h * 0.42, gy - 6], [cx + h * 0.42, gy - 6]], hex("#3d6a3c"));
  fillPolygon([[cx, gy - h * 0.75], [cx - h * 0.34, gy - h * 0.3], [cx + h * 0.34, gy - h * 0.3]], hex("#4d7a44"));
}

function balloon(cx: number, cy: number, r: number, stripe: string): void {
  // Basket + ropes first (behind the envelope's lower edge).
  const by = cy + r + 34;
  thickLine(cx - r * 0.45, cy + r * 0.75, cx - 7, by, 1.6, hex("#3a2438"));
  thickLine(cx + r * 0.45, cy + r * 0.75, cx + 7, by, 1.6, hex("#3a2438"));
  thickLine(cx, cy + r * 0.9, cx, by, 1.6, hex("#3a2438"));
  fillRect(cx - 9, by, cx + 9, by + 13, hex("#7a5230"));
  // Envelope: cream base, coloured vertical stripes, dark rim.
  fillCircle(cx, cy, r, hex("#f6e7c8"));
  fillEllipse(cx - r * 0.52, cy, r * 0.3, r * 0.97, hex(stripe));
  fillEllipse(cx + r * 0.52, cy, r * 0.3, r * 0.97, hex(stripe));
  fillEllipse(cx, cy, r * 0.3, r * 0.99, hex(stripe));
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    const px = cx + Math.cos(t) * r;
    const py = cy + Math.sin(t) * r;
    fillCircle(px, py, 1.6, hex("#5a3040"));
  }
  fillEllipse(cx, cy - r * 0.92, r * 0.16, r * 0.1, hex("#5a3040"));
}

function bird(cx: number, cy: number, s: number): void {
  const c = hex("#2a1745");
  polyline([[cx - s, cy], [cx - s * 0.35, cy - s * 0.45], [cx, cy]], 2.2, c);
  polyline([[cx, cy], [cx + s * 0.35, cy - s * 0.45], [cx + s, cy]], 2.2, c);
}

function waterfall(x: number, yTop: number, yBot: number, w: number): void {
  fillPolygon(
    [[x - w / 2, yTop], [x + w / 2, yTop], [x + w * 0.32, yBot], [x - w * 0.32, yBot]],
    hex("#bfe3f2"),
    0.92,
  );
  thickLine(x - w * 0.12, yTop + 6, x - w * 0.2, yBot - 8, 2, hex("#ffffff"), 0.85);
  thickLine(x + w * 0.18, yTop + 10, x + w * 0.1, yBot - 14, 1.6, hex("#ffffff"), 0.7);
}

// ---- The poster ----
function draw(): void {
  // 1. Dusk sky.
  gradient([
    [0, "#171133"], [0.28, "#3d2566"], [0.46, "#7a3a6e"],
    [0.58, "#c96a5e"], [0.66, "#f2a56b"], [1, "#8a4a6b"],
  ]);

  // 2. Stars in the upper sky.
  for (let i = 0; i < 130; i++) {
    const x = 12 + rnd() * 1000;
    let y = 8 + rnd() * 372;
    if (y > 100 && y < 292) y = 8 + rnd() * 90; // keep stars out of the title band
    const r = 0.8 + rnd() * 2.0;
    fillCircle(x, y, r, hex("#fff6e0"), 0.35 + rnd() * 0.6);
  }

  // 3. Low sun, right of centre.
  glow(742, 545, 190, hex("#ff9e5e"), 0.5);
  glow(742, 545, 110, hex("#ffd98a"), 0.6);
  fillCircle(742, 545, 62, hex("#ffe9b8"));

  // 4. Hot-air balloons.
  balloon(168, 392, 34, "#c94f5e");
  balloon(884, 448, 26, "#4a6fa5");

  // 5. Birds.
  bird(290, 336, 11);
  bird(372, 306, 9);
  bird(620, 210, 10);

  // 6. Far cloud bank behind the islands.
  for (let i = 0; i < 26; i++) {
    const x = 30 + rnd() * 964;
    const y = 640 + rnd() * 60;
    const rx = 42 + rnd() * 70;
    const ry = 10 + rnd() * 12;
    const c = rnd() < 0.3 ? hex("#e89a8c") : hex("#f6c39a");
    fillEllipse(x, y, rx, ry, c, 0.9);
  }

  // 7. MAIN island.
  // Rocky underside, tapering to a point.
  fillPolygon(
    [[246, 660], [764, 660], [706, 748], [640, 822], [566, 898], [498, 824], [408, 772], [318, 716]],
    hex("#3a2b50"),
  );
  // Warm rim light on the right edge.
  polyline([[764, 662], [706, 748], [640, 822], [566, 898]], 5, hex("#f2a56b"), 0.8);
  // Grassy plateau with a lighter top edge.
  fillPolygon([[246, 668], [262, 642], [748, 642], [764, 668]], hex("#6f8f52"));
  thickLine(262, 643, 748, 643, 4, hex("#8aa864"));
  // Waterfalls off the plateau edges, into the cloud sea.
  waterfall(306, 668, 838, 26);
  waterfall(706, 668, 832, 22);

  // Lantern tower, centre-left.
  fillPolygon([[468, 640], [544, 640], [534, 500], [478, 500]], hex("#46345e"));
  fillRect(460, 632, 552, 642, hex("#3a2b50"));
  for (let i = 0; i < 4; i++) {
    const wx = 482 + i * 16;
    glow(wx + 5, 560, 12, hex("#ffb347"), 0.4);
    fillRect(wx, 552, wx + 10, 568, hex("#ffb347"));
  }
  fillRect(482, 516, 530, 528, hex("#7a3a4d"));
  // Big glowing lantern on top, with cap and hanging string.
  glow(506, 462, 46, hex("#ffb347"), 0.55);
  fillEllipse(506, 462, 20, 24, hex("#ffb347"));
  fillEllipse(506, 462, 9, 13, hex("#ffe9b8"));
  fillRect(494, 434, 518, 442, hex("#5a3040"));
  thickLine(506, 434, 506, 420, 2, hex("#3a2438"));
  fillCircle(506, 418, 4, hex("#ffb347"));
  // Lantern strings draping left and right, with small hanging lanterns.
  polyline([[478, 500], [430, 528], [392, 516], [352, 540]], 2, hex("#3a2438"));
  polyline([[534, 500], [580, 530], [620, 518], [660, 542]], 2, hex("#3a2438"));
  lantern(392, 532, 7, "#c94f5e", 16);
  lantern(352, 556, 6, "#e8a33d", 14);
  lantern(620, 534, 7, "#c94f5e", 16);
  lantern(660, 558, 6, "#e8a33d", 14);

  // Three houses and a round-canopy tree on the plateau.
  house(288, 592, 62, 50, "#f2d8a8", "#7a3a4d");
  house(566, 596, 56, 46, "#e8b98a", "#5a3040");
  house(648, 600, 52, 42, "#f2d8a8", "#7a3a4d");
  tree(448, 642, 22, 20);
  tree(726, 642, 16, 15);

  // 8. RIGHT island.
  fillPolygon([[800, 706], [998, 706], [962, 762], [920, 812], [888, 842], [852, 792], [818, 748]], hex("#3a2b50"));
  fillPolygon([[800, 708], [812, 690], [986, 690], [998, 708]], hex("#6f8f52"));
  thickLine(812, 691, 986, 691, 3, hex("#8aa864"));
  // Shrine: cream walls, triangular dark-red roof, glowing door.
  fillRect(876, 646, 940, 690, hex("#f2d8a8"));
  fillPolygon([[868, 646], [908, 612], [948, 646]], hex("#7a3a4d"));
  glow(908, 672, 14, hex("#ffb347"), 0.45);
  fillRect(900, 660, 916, 690, hex("#ffb347"));
  fillRect(872, 690, 944, 694, hex("#5a3040"));
  pine(830, 692, 44);
  lantern(962, 676, 6, "#c94f5e", 14);

  // 9. LEFT island.
  fillPolygon([[30, 768], [220, 768], [196, 820], [160, 862], [126, 892], [92, 838], [52, 800]], hex("#3a2b50"));
  fillPolygon([[30, 770], [44, 752], [206, 752], [220, 770]], hex("#6f8f52"));
  thickLine(44, 753, 206, 753, 3, hex("#8aa864"));
  house(96, 706, 54, 46, "#f2d8a8", "#7a3a4d");
  tree(188, 754, 18, 16);

  // 10. Cloud sea in front, with crest puffs where the waterfalls land.
  const seaCols = ["#f2b08a", "#f7cfae", "#c97a72"];
  for (let i = 0; i < 40; i++) {
    const x = 10 + rnd() * 1004;
    const y = 830 + rnd() * 190;
    const rx = 55 + rnd() * 95;
    const ry = 16 + rnd() * 22;
    fillEllipse(x, y, rx, ry, hex(seaCols[i % 3]), 0.92);
  }
  fillEllipse(306, 842, 46, 18, hex("#fdf0d8"), 0.95);
  fillEllipse(322, 856, 34, 14, hex("#fdf0d8"), 0.9);
  fillEllipse(706, 836, 42, 17, hex("#fdf0d8"), 0.95);
  fillEllipse(690, 850, 30, 13, hex("#fdf0d8"), 0.9);

  // 11. Title and subtitle.
  drawText("VELMORA", 512, 118, 104, 16, 11, hex("#2a1745"));
  drawText("VELMORA", 508, 114, 104, 16, 11, hex("#fff2cf"));
  drawText("THE CITY ABOVE THE CLOUDS", 512, 252, 26, 9, 3.4, hex("#ffe9c4"));
}

function main(): void {
  const outDir = process.argv[2] ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  draw();
  const png = encodePng();
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  validatePng(png);
  console.log("validated entry.png: " + png.length + " bytes, 1024x1024, 8-bit RGB");
}

main();
