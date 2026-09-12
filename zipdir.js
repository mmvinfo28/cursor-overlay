// Zip a folder in memory (deflate, no dependencies) so it can be attached to a task.
// Skips the usual junk (node_modules, .git, build output), caps file and total size.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', 'target']);
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;     // bucket limit is 25 MB

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// DOS date/time for the zip headers
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function walk(root) {
  const files = [];
  const rec = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.isDirectory() && e.name !== '.') { if (SKIP_DIRS.has(e.name)) continue; }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(p); }
      else if (e.isFile()) files.push(p);
    }
  };
  rec(root);
  return files;
}

// returns { buffer, count, skipped, listing }
function zipDir(root) {
  const files = walk(root);
  const parts = [], central = [];
  let offset = 0, total = 0, count = 0, skipped = 0;
  const listing = [];
  for (const f of files) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (st.size > MAX_FILE) { skipped++; continue; }
    if (total + st.size > MAX_TOTAL) { skipped++; continue; }
    const rel = path.relative(root, f).split(path.sep).join('/');
    const name = Buffer.from(rel, 'utf8');
    const data = fs.readFileSync(f);
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const { time, date } = dosTime(st.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
    total += st.size; count++;
    if (listing.length < 300) listing.push(rel);
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(cdStart, 16); end.writeUInt16LE(0, 20);
  return { buffer: Buffer.concat([...parts, cdBuf, end]), count, skipped, listing, total };
}

module.exports = { zipDir };
