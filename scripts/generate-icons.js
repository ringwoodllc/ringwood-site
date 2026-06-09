// Generate Ringwood home-screen icons as PNGs (no external deps).
// Concentric tree-ring logo: paper rings on deep evergreen.
const zlib = require("zlib");
const fs = require("fs");

const BG = [31, 61, 43];      // #1f3d2b evergreen
const FG = [244, 241, 234];   // #f4efe4 paper

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

// coverage of a ring stroke (centered at radius R, half-thickness h) at distance d
function ringCov(d, R, h) {
  const e = Math.abs(d - R);
  return Math.max(0, Math.min(1, (h - e) + 0.5)); // ~1px feather
}
function diskCov(d, R) {
  return Math.max(0, Math.min(1, (R - d) + 0.5));
}

function makeIcon(size, pad) {
  const cx = size / 2, cy = size / 2;
  const usable = size / 2 - pad;
  // ring radii + thickness, scaled to usable radius
  const rings = [
    { R: usable * 0.92, h: usable * 0.075 },
    { R: usable * 0.64, h: usable * 0.075 },
    { R: usable * 0.36, h: usable * 0.075 },
  ];
  const dot = usable * 0.13;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      let cov = diskCov(d, dot);
      for (const r of rings) cov = Math.max(cov, ringCov(d, r.R, r.h));
      cov = Math.max(0, Math.min(1, cov));
      raw[p++] = Math.round(BG[0] + (FG[0] - BG[0]) * cov);
      raw[p++] = Math.round(BG[1] + (FG[1] - BG[1]) * cov);
      raw[p++] = Math.round(BG[2] + (FG[2] - BG[2]) * cov);
      raw[p++] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

fs.mkdirSync("public/icons", { recursive: true });
fs.writeFileSync("public/icons/icon-512.png", makeIcon(512, 56));
fs.writeFileSync("public/icons/icon-192.png", makeIcon(192, 20));
fs.writeFileSync("public/icons/apple-touch-icon.png", makeIcon(180, 0)); // iOS adds its own rounding
console.log("icons written");
