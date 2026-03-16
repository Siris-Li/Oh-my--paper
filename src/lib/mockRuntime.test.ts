import { describe, expect, it } from "vitest";

import { mockRuntime } from "./mockRuntime";

describe("mockRuntime.saveFile", () => {
  it("creates missing files to match desktop save semantics", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `.viewerleaf/collab-${suffix}.json`;
    const content = JSON.stringify({ ok: true, suffix });

    await mockRuntime.saveFile(path, content);

    await expect(mockRuntime.readFile(path)).resolves.toMatchObject({
      path,
      language: "json",
      content,
    });

    await mockRuntime.deleteFile(path);
  });
});
