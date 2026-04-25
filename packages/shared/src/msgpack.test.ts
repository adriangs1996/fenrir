import { describe, expect, it } from "vitest";

import { msgpackDecode, MsgpackDecodeError } from "./msgpack";

/** Shorthand to build a Uint8Array from byte values. */
const bytes = (...b: number[]) => new Uint8Array(b);

/** Encode a UTF-8 string to raw bytes for embedding in test buffers. */
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Concat multiple Uint8Arrays into one. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((acc, a) => acc + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ─── nil / bool ────────────────────────────────────────────────────────────

describe("nil", () => {
  it("decodes 0xc0 as null", () => {
    expect(msgpackDecode(bytes(0xc0))).toBe(null);
  });
});

describe("bool", () => {
  it("decodes 0xc2 as false", () => {
    expect(msgpackDecode(bytes(0xc2))).toBe(false);
  });

  it("decodes 0xc3 as true", () => {
    expect(msgpackDecode(bytes(0xc3))).toBe(true);
  });
});

// ─── integers ──────────────────────────────────────────────────────────────

describe("positive fixint", () => {
  it("decodes 0 (0x00)", () => {
    expect(msgpackDecode(bytes(0x00))).toBe(0);
  });

  it("decodes 1 (0x01)", () => {
    expect(msgpackDecode(bytes(0x01))).toBe(1);
  });

  it("decodes 127 (0x7f)", () => {
    expect(msgpackDecode(bytes(0x7f))).toBe(127);
  });

  it("decodes 42 (0x2a)", () => {
    expect(msgpackDecode(bytes(0x2a))).toBe(42);
  });
});

describe("negative fixint", () => {
  it("decodes -1 (0xff)", () => {
    expect(msgpackDecode(bytes(0xff))).toBe(-1);
  });

  it("decodes -32 (0xe0)", () => {
    expect(msgpackDecode(bytes(0xe0))).toBe(-32);
  });

  it("decodes -5 (0xfb)", () => {
    expect(msgpackDecode(bytes(0xfb))).toBe(-5);
  });
});

describe("uint8", () => {
  it("decodes 200", () => {
    expect(msgpackDecode(bytes(0xcc, 200))).toBe(200);
  });

  it("decodes 255", () => {
    expect(msgpackDecode(bytes(0xcc, 0xff))).toBe(255);
  });

  it("decodes 128 (just above fixint range)", () => {
    expect(msgpackDecode(bytes(0xcc, 128))).toBe(128);
  });
});

describe("uint16", () => {
  it("decodes 256", () => {
    expect(msgpackDecode(bytes(0xcd, 0x01, 0x00))).toBe(256);
  });

  it("decodes 65535", () => {
    expect(msgpackDecode(bytes(0xcd, 0xff, 0xff))).toBe(65535);
  });

  it("decodes 4444 (0x115c)", () => {
    expect(msgpackDecode(bytes(0xcd, 0x11, 0x5c))).toBe(4444);
  });
});

describe("uint32", () => {
  it("decodes 70000 (0x00011170)", () => {
    expect(msgpackDecode(bytes(0xce, 0x00, 0x01, 0x11, 0x70))).toBe(70000);
  });

  it("decodes 2^32-1", () => {
    expect(msgpackDecode(bytes(0xce, 0xff, 0xff, 0xff, 0xff))).toBe(4294967295);
  });
});

describe("int8", () => {
  it("decodes -100", () => {
    // -100 as signed byte = 0x9c
    expect(msgpackDecode(bytes(0xd0, 0x9c))).toBe(-100);
  });

  it("decodes -128", () => {
    expect(msgpackDecode(bytes(0xd0, 0x80))).toBe(-128);
  });

  it("decodes 50", () => {
    expect(msgpackDecode(bytes(0xd0, 50))).toBe(50);
  });
});

describe("int16", () => {
  it("decodes -1000", () => {
    // -1000 = 0xfc18
    expect(msgpackDecode(bytes(0xd1, 0xfc, 0x18))).toBe(-1000);
  });

  it("decodes -32768", () => {
    expect(msgpackDecode(bytes(0xd1, 0x80, 0x00))).toBe(-32768);
  });
});

describe("int32", () => {
  it("decodes -100000", () => {
    // -100000 = 0xfffe7960
    expect(msgpackDecode(bytes(0xd2, 0xff, 0xfe, 0x79, 0x60))).toBe(-100000);
  });

  it("decodes -1", () => {
    expect(msgpackDecode(bytes(0xd2, 0xff, 0xff, 0xff, 0xff))).toBe(-1);
  });
});

// ─── floats ────────────────────────────────────────────────────────────────

describe("float32", () => {
  it("decodes 0.0", () => {
    expect(msgpackDecode(bytes(0xca, 0x00, 0x00, 0x00, 0x00))).toBe(0);
  });

  it("decodes 1.5", () => {
    // IEEE 754 float32 for 1.5 = 0x3fc00000
    expect(msgpackDecode(bytes(0xca, 0x3f, 0xc0, 0x00, 0x00))).toBeCloseTo(1.5);
  });

  it("decodes -1.5", () => {
    // IEEE 754 float32 for -1.5 = 0xbfc00000
    expect(msgpackDecode(bytes(0xca, 0xbf, 0xc0, 0x00, 0x00))).toBeCloseTo(-1.5);
  });
});

describe("float64", () => {
  it("decodes 3.141592653589793", () => {
    // IEEE 754 float64 for PI = 0x400921fb54442d18
    expect(
      msgpackDecode(bytes(0xcb, 0x40, 0x09, 0x21, 0xfb, 0x54, 0x44, 0x2d, 0x18)),
    ).toBeCloseTo(Math.PI, 14);
  });

  it("decodes -0.1", () => {
    // IEEE 754 float64 for -0.1 = 0xBFB999999999999A
    expect(
      msgpackDecode(bytes(0xcb, 0xbf, 0xb9, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a)),
    ).toBeCloseTo(-0.1);
  });
});

// ─── strings (str family) ──────────────────────────────────────────────────

describe("fixstr", () => {
  it("decodes empty string", () => {
    // fixstr length=0: 0xa0
    expect(msgpackDecode(bytes(0xa0))).toBe("");
  });

  it("decodes short ASCII string", () => {
    // fixstr length=5: 0xa5 + "hello"
    expect(msgpackDecode(concat(bytes(0xa5), utf8("hello")))).toBe("hello");
  });

  it("decodes 31-byte string (max fixstr)", () => {
    const s = "a".repeat(31);
    expect(msgpackDecode(concat(bytes(0xbf), utf8(s)))).toBe(s);
  });

  it("decodes UTF-8 multibyte characters", () => {
    const s = "café";
    const encoded = utf8(s);
    // fixstr with the encoded byte length
    expect(
      msgpackDecode(concat(bytes(0xa0 | encoded.length), encoded)),
    ).toBe(s);
  });
});

describe("str8", () => {
  it("decodes 32-byte string", () => {
    const s = "x".repeat(32);
    const encoded = utf8(s);
    expect(msgpackDecode(concat(bytes(0xd9, 32), encoded))).toBe(s);
  });

  it("decodes 200-byte string", () => {
    const s = "A".repeat(200);
    const encoded = utf8(s);
    expect(msgpackDecode(concat(bytes(0xd9, 200), encoded))).toBe(s);
  });
});

describe("str16", () => {
  it("decodes 300-byte string", () => {
    const s = "B".repeat(300);
    const encoded = utf8(s);
    // str16: 0xda + 2-byte length (big-endian)
    expect(
      msgpackDecode(concat(bytes(0xda, 0x01, 0x2c), encoded)),
    ).toBe(s);
  });
});

describe("str32", () => {
  it("decodes string with 4-byte length prefix", () => {
    const s = "C".repeat(100);
    const encoded = utf8(s);
    // str32: 0xdb + 4-byte length
    expect(
      msgpackDecode(concat(bytes(0xdb, 0x00, 0x00, 0x00, 100), encoded)),
    ).toBe(s);
  });
});

// ─── binary → string (Ruby compat) ────────────────────────────────────────

describe("bin8 (Ruby string compat)", () => {
  it("decodes bin8 as UTF-8 string", () => {
    // bin8: 0xc4 + 1-byte length + data
    expect(
      msgpackDecode(concat(bytes(0xc4, 6), utf8("result"))),
    ).toBe("result");
  });

  it("decodes empty bin8 as empty string", () => {
    expect(msgpackDecode(bytes(0xc4, 0x00))).toBe("");
  });

  it("decodes bin8 with UTF-8 content", () => {
    const s = "données";
    const encoded = utf8(s);
    expect(
      msgpackDecode(concat(bytes(0xc4, encoded.length), encoded)),
    ).toBe(s);
  });
});

describe("bin16 (Ruby string compat)", () => {
  it("decodes bin16 as UTF-8 string", () => {
    const s = "D".repeat(300);
    const encoded = utf8(s);
    expect(
      msgpackDecode(concat(bytes(0xc5, 0x01, 0x2c), encoded)),
    ).toBe(s);
  });
});

describe("bin32 (Ruby string compat)", () => {
  it("decodes bin32 as UTF-8 string", () => {
    const s = "E".repeat(100);
    const encoded = utf8(s);
    expect(
      msgpackDecode(concat(bytes(0xc6, 0x00, 0x00, 0x00, 100), encoded)),
    ).toBe(s);
  });
});

// ─── arrays ────────────────────────────────────────────────────────────────

describe("fixarray", () => {
  it("decodes empty array", () => {
    // fixarray length=0: 0x90
    expect(msgpackDecode(bytes(0x90))).toEqual([]);
  });

  it("decodes array of integers", () => {
    // fixarray length=3: [1, 2, 3]
    expect(msgpackDecode(bytes(0x93, 0x01, 0x02, 0x03))).toEqual([1, 2, 3]);
  });

  it("decodes mixed-type array", () => {
    // [42, true, null]
    expect(msgpackDecode(bytes(0x93, 0x2a, 0xc3, 0xc0))).toEqual([42, true, null]);
  });

  it("decodes nested arrays", () => {
    // [[1, 2], [3]]
    expect(
      msgpackDecode(bytes(0x92, 0x92, 0x01, 0x02, 0x91, 0x03)),
    ).toEqual([[1, 2], [3]]);
  });

  it("decodes 15-element array (max fixarray)", () => {
    // fixarray length=15: 0x9f
    const data = bytes(0x9f, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14);
    expect(msgpackDecode(data)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});

describe("array16", () => {
  it("decodes 16-element array", () => {
    // array16: 0xdc + 2-byte length + elements
    const elements = new Array(16).fill(0).map((_, i) => i);
    const data = concat(
      bytes(0xdc, 0x00, 0x10),
      bytes(...elements),
    );
    expect(msgpackDecode(data)).toEqual(elements);
  });
});

describe("array32", () => {
  it("decodes array with 4-byte length prefix", () => {
    // array32: 0xdd + 4-byte length + elements
    const data = concat(
      bytes(0xdd, 0x00, 0x00, 0x00, 0x03),
      bytes(0x0a, 0x0b, 0x0c),
    );
    expect(msgpackDecode(data)).toEqual([10, 11, 12]);
  });
});

// ─── maps ──────────────────────────────────────────────────────────────────

describe("fixmap", () => {
  it("decodes empty map", () => {
    // fixmap length=0: 0x80
    expect(msgpackDecode(bytes(0x80))).toEqual({});
  });

  it("decodes single-entry map with fixstr keys", () => {
    // { "a": 1 }
    expect(
      msgpackDecode(concat(bytes(0x81, 0xa1), utf8("a"), bytes(0x01))),
    ).toEqual({ a: 1 });
  });

  it("decodes multi-entry map with fixstr keys", () => {
    // { "x": 10, "y": 20 }
    expect(
      msgpackDecode(
        concat(
          bytes(0x82),
          bytes(0xa1), utf8("x"), bytes(0x0a),
          bytes(0xa1), utf8("y"), bytes(0x14),
        ),
      ),
    ).toEqual({ x: 10, y: 20 });
  });

  it("decodes map with bin-type keys (Ruby style)", () => {
    // Ruby encodes keys as bin8: { "result": "success" }
    expect(
      msgpackDecode(
        concat(
          bytes(0x81),
          bytes(0xc4, 6), utf8("result"),
          bytes(0xc4, 7), utf8("success"),
        ),
      ),
    ).toEqual({ result: "success" });
  });

  it("decodes integer keys as stringified", () => {
    // { 42: "val" }
    expect(
      msgpackDecode(
        concat(bytes(0x81, 0x2a, 0xa3), utf8("val")),
      ),
    ).toEqual({ "42": "val" });
  });

  it("decodes nested maps", () => {
    // { "a": { "b": 1 } }
    expect(
      msgpackDecode(
        concat(
          bytes(0x81),
          bytes(0xa1), utf8("a"),
          bytes(0x81),
          bytes(0xa1), utf8("b"),
          bytes(0x01),
        ),
      ),
    ).toEqual({ a: { b: 1 } });
  });
});

describe("map16", () => {
  it("decodes map with 16-bit length prefix", () => {
    // map16: 0xde + 2-byte count + entries
    // { "k": 99 }
    expect(
      msgpackDecode(
        concat(bytes(0xde, 0x00, 0x01), bytes(0xa1), utf8("k"), bytes(0x63)),
      ),
    ).toEqual({ k: 99 });
  });
});

describe("map32", () => {
  it("decodes map with 32-bit length prefix", () => {
    // map32: 0xdf + 4-byte count + entries
    // { "z": false }
    expect(
      msgpackDecode(
        concat(bytes(0xdf, 0x00, 0x00, 0x00, 0x01), bytes(0xa1), utf8("z"), bytes(0xc2)),
      ),
    ).toEqual({ z: false });
  });
});

// ─── Ruby MSFRPC response simulation ──────────────────────────────────────

describe("Ruby MSFRPC auth.login response", () => {
  it("decodes a realistic auth.login success response", () => {
    // Simulates: { "result" => "success", "token" => "TEMP1234abcd" }
    // All strings encoded as bin8 (Ruby style)
    const result = msgpackDecode(
      concat(
        bytes(0x82), // fixmap 2 entries
        bytes(0xc4, 6), utf8("result"),
        bytes(0xc4, 7), utf8("success"),
        bytes(0xc4, 5), utf8("token"),
        bytes(0xc4, 12), utf8("TEMP1234abcd"),
      ),
    );
    expect(result).toEqual({ result: "success", token: "TEMP1234abcd" });
  });

  it("decodes a realistic session.list response with nested maps", () => {
    // { "1" => { "type" => "shell", "info" => "", "session_host" => "10.0.0.5" } }
    const result = msgpackDecode(
      concat(
        bytes(0x81), // fixmap 1 entry
        bytes(0xc4, 1), utf8("1"), // key "1" as bin8
        bytes(0x83), // fixmap 3 entries
        bytes(0xc4, 4), utf8("type"),
        bytes(0xc4, 5), utf8("shell"),
        bytes(0xc4, 4), utf8("info"),
        bytes(0xc4, 0), // empty string
        bytes(0xc4, 12), utf8("session_host"),
        bytes(0xc4, 8), utf8("10.0.0.5"),
      ),
    );
    expect(result).toEqual({
      "1": {
        type: "shell",
        info: "",
        session_host: "10.0.0.5",
      },
    });
  });

  it("decodes a module.execute response with integer job_id", () => {
    // { "job_id" => 0, "uuid" => "abc123" }
    const result = msgpackDecode(
      concat(
        bytes(0x82),
        bytes(0xc4, 6), utf8("job_id"),
        bytes(0x00), // fixint 0
        bytes(0xc4, 4), utf8("uuid"),
        bytes(0xc4, 6), utf8("abc123"),
      ),
    );
    expect(result).toEqual({ job_id: 0, uuid: "abc123" });
  });

  it("decodes error response with array backtrace", () => {
    // { "error" => true, "error_message" => "not found", "error_backtrace" => ["line1", "line2"] }
    const result = msgpackDecode(
      concat(
        bytes(0x83), // fixmap 3 entries
        bytes(0xc4, 5), utf8("error"),
        bytes(0xc3), // true
        bytes(0xc4, 13), utf8("error_message"),
        bytes(0xc4, 9), utf8("not found"),
        bytes(0xc4, 15), utf8("error_backtrace"),
        bytes(0x92), // fixarray 2 elements
        bytes(0xc4, 5), utf8("line1"),
        bytes(0xc4, 5), utf8("line2"),
      ),
    );
    expect(result).toEqual({
      error: true,
      error_message: "not found",
      error_backtrace: ["line1", "line2"],
    });
  });
});

// ─── edge cases & errors ───────────────────────────────────────────────────

describe("error handling", () => {
  it("throws on empty buffer", () => {
    expect(() => msgpackDecode(new Uint8Array(0))).toThrow(MsgpackDecodeError);
    expect(() => msgpackDecode(new Uint8Array(0))).toThrow("Cannot decode empty buffer");
  });

  it("throws on trailing bytes", () => {
    // null (0xc0) followed by extra byte
    expect(() => msgpackDecode(bytes(0xc0, 0x01))).toThrow(MsgpackDecodeError);
    expect(() => msgpackDecode(bytes(0xc0, 0x01))).toThrow("trailing bytes");
  });

  it("throws on unsupported type (0xc1 — never used)", () => {
    expect(() => msgpackDecode(bytes(0xc1))).toThrow(MsgpackDecodeError);
    expect(() => msgpackDecode(bytes(0xc1))).toThrow("Unsupported msgpack type: 0xc1");
  });

  it("throws on truncated uint16", () => {
    // 0xcd expects 2 bytes, only 1 provided
    expect(() => msgpackDecode(bytes(0xcd, 0x01))).toThrow(MsgpackDecodeError);
    expect(() => msgpackDecode(bytes(0xcd, 0x01))).toThrow("Unexpected end of buffer");
  });

  it("throws on truncated string", () => {
    // fixstr length=5 but only 3 bytes of data
    expect(() => msgpackDecode(concat(bytes(0xa5), utf8("abc")))).toThrow(MsgpackDecodeError);
  });

  it("throws on truncated map value", () => {
    // fixmap 1 entry, key present but value missing
    expect(() =>
      msgpackDecode(concat(bytes(0x81, 0xa1), utf8("k"))),
    ).toThrow(MsgpackDecodeError);
  });

  it("throws on truncated array element", () => {
    // fixarray 2 elements, only 1 provided
    expect(() => msgpackDecode(bytes(0x92, 0x01))).toThrow(MsgpackDecodeError);
  });

  it("throws on ext type (fixext1 = 0xd4)", () => {
    expect(() => msgpackDecode(bytes(0xd4, 0x01, 0xff))).toThrow(MsgpackDecodeError);
    expect(() => msgpackDecode(bytes(0xd4, 0x01, 0xff))).toThrow("Unsupported msgpack type: 0xd4");
  });
});

describe("Uint8Array with non-zero byteOffset", () => {
  it("handles subarray with offset correctly", () => {
    // Simulate a buffer where msgpack data starts at a non-zero offset
    const backing = new Uint8Array([0xff, 0xff, 0x2a, 0xff, 0xff]);
    const sub = backing.subarray(2, 3); // just the fixint 42
    expect(msgpackDecode(sub)).toBe(42);
  });

  it("handles map in sliced ArrayBuffer", () => {
    // { "a": 1 } but embedded in a larger buffer
    const full = concat(bytes(0x00, 0x00), bytes(0x81, 0xa1), utf8("a"), bytes(0x01), bytes(0x00));
    const sub = full.subarray(2, 6);
    expect(msgpackDecode(sub)).toEqual({ a: 1 });
  });
});
