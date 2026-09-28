const CART_RE = /\.(nds|dsi|ids|srl)$/i;

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}

function u32(b: Uint8Array, o: number): number {
  return (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
}

function findEocd(buf: Uint8Array): number {
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x01)
  );
}

export async function extractDsCart(blob: Blob): Promise<File | null> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (!isZip(buf)) return null;
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const cdOff = u32(buf, eocd + 16);
  const cdSize = u32(buf, eocd + 12);
  const cdEnd = Math.min(buf.length, cdOff + cdSize);
  const decoder = new TextDecoder();
  const carts: { name: string; data: Uint8Array }[] = [];
  let p = cdOff;
  while (p + 46 <= cdEnd) {
    if (buf[p] !== 0x50 || buf[p + 1] !== 0x4b || buf[p + 2] !== 0x01 || buf[p + 3] !== 0x02) {
      break;
    }
    const method = u16(buf, p + 10);
    const compact = u32(buf, p + 20);
    const raw = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOff = u32(buf, p + 42);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!CART_RE.test(name) || name.endsWith("/")) continue;
    if (localOff + 30 >= buf.length) continue;
    const localNameLen = u16(buf, localOff + 26);
    const localExtra = u16(buf, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    if (dataStart + compact > buf.length) continue;
    const packed = buf.subarray(dataStart, dataStart + compact);
    let data: Uint8Array;
    try {
      if (method === 0) data = packed.slice();
      else if (method === 8) data = await inflateRaw(packed);
      else continue;
    } catch {
      continue;
    }
    if (raw && data.byteLength !== raw) continue;
    carts.push({ name, data });
  }
  if (!carts.length) return null;
  carts.sort((a, b) => b.data.length - a.data.length);
  const hit = carts[0]!;
  const base = hit.name.split("/").pop() || "game.nds";
  const copy = new Uint8Array(hit.data.byteLength);
  copy.set(hit.data);
  return new File([copy], base, { type: "application/octet-stream" });
}
