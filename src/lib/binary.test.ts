import { describe, expect, it } from "vitest";

import { normalizeBinary } from "./binary";

describe("normalizeBinary", () => {
  it("returns Uint8Array inputs unchanged", () => {
    const bytes = new Uint8Array([1, 2, 3]);

    expect(normalizeBinary(bytes)).toBe(bytes);
  });

  it("converts ArrayBuffer inputs", () => {
    const bytes = new Uint8Array([4, 5, 6]);

    expect(Array.from(normalizeBinary(bytes.buffer) ?? [])).toEqual([4, 5, 6]);
  });

  it("converts typed array views without losing slice offsets", () => {
    const source = new Uint8Array([9, 8, 7, 6]);
    const view = new Uint8Array(source.buffer, 1, 2);

    expect(Array.from(normalizeBinary(view) ?? [])).toEqual([8, 7]);
  });

  it("converts nested buffer-like payloads", () => {
    expect(Array.from(normalizeBinary({ data: { data: [10, 11] } }) ?? [])).toEqual([10, 11]);
  });
});
