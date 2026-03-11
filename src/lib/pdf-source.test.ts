import { describe, expect, it } from "vitest";

import { resolvePdfSource } from "./pdf-source";

describe("resolvePdfSource", () => {
  it("prefers binary pdf data when available", () => {
    const bytes = new Uint8Array([1, 2, 3]);

    expect(resolvePdfSource(bytes, "asset://localhost/test.pdf", false)).toBe(bytes);
  });

  it("allows url fallback outside tauri", () => {
    expect(resolvePdfSource(undefined, "blob:mock-pdf", true)).toBe("blob:mock-pdf");
  });

  it("suppresses url fallback in tauri mode", () => {
    expect(resolvePdfSource(undefined, "asset://localhost/test.pdf", false)).toBeUndefined();
  });
});
