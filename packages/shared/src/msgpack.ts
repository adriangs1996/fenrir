/**
 * Minimal MessagePack decoder compatible with Ruby's msgpack output.
 *
 * Ruby's msgpack library encodes all strings using the "bin" family
 * (0xc4 / 0xc5 / 0xc6) rather than the "str" family. Standard JS
 * MessagePack decoders turn bin payloads into `Uint8Array`, which
 * breaks when used as object keys and misrepresents the actual data.
 *
 * This decoder treats **both** str and bin types as UTF-8 strings,
 * producing plain JS objects that match the Ruby-side intent.
 *
 * Supported types:
 *   nil, bool, positive/negative fixint, uint8/16/32, int8/16/32,
 *   float32/64, fixstr, str8/16/32, bin8/16/32 (→ string),
 *   fixarray, array16/32, fixmap, map16/32.
 *
 * Not supported (throws): ext types, uint64, int64, bin-as-binary mode.
 *
 * @module msgpack
 */

export class MsgpackDecodeError extends Error {
  override readonly name = "MsgpackDecodeError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Decode a MessagePack buffer into a JS value.
 *
 * Binary (bin) payloads are decoded as UTF-8 strings for Ruby compatibility.
 * Throws `MsgpackDecodeError` on unsupported or malformed data.
 */
export function msgpackDecode(buf: Uint8Array): unknown {
  if (buf.length === 0) {
    throw new MsgpackDecodeError("Cannot decode empty buffer");
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;

  function u8(): number {
    if (offset >= buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    return buf[offset++]!;
  }
  function u16(): number {
    if (offset + 2 > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const v = view.getUint16(offset);
    offset += 2;
    return v;
  }
  function u32(): number {
    if (offset + 4 > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const v = view.getUint32(offset);
    offset += 4;
    return v;
  }
  function i8(): number {
    if (offset >= buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    return view.getInt8(offset++);
  }
  function i16(): number {
    if (offset + 2 > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const v = view.getInt16(offset);
    offset += 2;
    return v;
  }
  function i32(): number {
    if (offset + 4 > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const v = view.getInt32(offset);
    offset += 4;
    return v;
  }
  function f32(): number {
    if (offset + 4 > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const v = view.getFloat32(offset);
    offset += 4;
    return v;
  }
  function f64(): number {
    if (offset + 8 > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const v = view.getFloat64(offset);
    offset += 8;
    return v;
  }
  function str(len: number): string {
    if (offset + len > buf.length) throw new MsgpackDecodeError("Unexpected end of buffer");
    const s = new TextDecoder().decode(buf.subarray(offset, offset + len));
    offset += len;
    return s;
  }

  function read(): unknown {
    const b = u8();
    // positive fixint (0x00–0x7f)
    if (b <= 0x7f) return b;
    // fixmap (0x80–0x8f)
    if ((b & 0xf0) === 0x80) return readMap(b & 0x0f);
    // fixarray (0x90–0x9f)
    if ((b & 0xf0) === 0x90) return readArray(b & 0x0f);
    // fixstr (0xa0–0xbf)
    if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
    // negative fixint (0xe0–0xff)
    if (b >= 0xe0) return b - 256;
    switch (b) {
      case 0xc0: return null;
      // 0xc1 is never used
      case 0xc2: return false;
      case 0xc3: return true;
      // bin8/16/32 → decode as UTF-8 string (Ruby compat)
      case 0xc4: return str(u8());
      case 0xc5: return str(u16());
      case 0xc6: return str(u32());
      // float32/64
      case 0xca: return f32();
      case 0xcb: return f64();
      // uint8/16/32
      case 0xcc: return u8();
      case 0xcd: return u16();
      case 0xce: return u32();
      // int8/16/32
      case 0xd0: return i8();
      case 0xd1: return i16();
      case 0xd2: return i32();
      // str8/16/32
      case 0xd9: return str(u8());
      case 0xda: return str(u16());
      case 0xdb: return str(u32());
      // array16/32
      case 0xdc: return readArray(u16());
      case 0xdd: return readArray(u32());
      // map16/32
      case 0xde: return readMap(u16());
      case 0xdf: return readMap(u32());
      default:
        throw new MsgpackDecodeError(
          `Unsupported msgpack type: 0x${b.toString(16)} at offset ${offset - 1}`,
        );
    }
  }

  function readMap(n: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      obj[String(read())] = read();
    }
    return obj;
  }

  function readArray(n: number): unknown[] {
    const arr: unknown[] = [];
    for (let i = 0; i < n; i++) arr.push(read());
    return arr;
  }

  const result = read();

  if (offset !== buf.length) {
    throw new MsgpackDecodeError(
      `${buf.length - offset} trailing bytes after decoded value`,
    );
  }

  return result;
}
