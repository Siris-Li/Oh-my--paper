import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const shared = vi.hoisted(() => {
  const providerInstances: Array<{
    sendDocumentUpdate: ReturnType<typeof vi.fn>;
  }> = [];

  class MockProvider {
    readonly sendDocumentUpdate = vi.fn(() => true);
    private readonly listeners = new Map<string, Set<() => void>>();

    constructor() {
      providerInstances.push(this);
    }

    on(event: string, callback: () => void) {
      const set = this.listeners.get(event) ?? new Set();
      set.add(callback);
      this.listeners.set(event, set);
    }

    off(event: string, callback: () => void) {
      this.listeners.get(event)?.delete(callback);
    }

    connect() {
      this.listeners.get("sync")?.forEach((listener) => listener());
    }

    destroy() {}
  }

  return {
    ensureCloudDocument: vi.fn(async () => undefined),
    fetchDocumentSnapshot: vi.fn(async () => new Uint8Array([0, 0])),
    providerInstances,
    MockProvider,
  };
});

vi.mock("./cloud-api", () => ({
  ensureCloudDocument: shared.ensureCloudDocument,
  fetchDocumentSnapshot: shared.fetchDocumentSnapshot,
}));

vi.mock("./auth", () => ({
  buildCollabWebSocketUrl: () => "ws://localhost:8787/api/projects/project-1/ws?path=main.tex",
}));

vi.mock("./yjs-provider", () => ({
  ViewerLeafProvider: shared.MockProvider,
}));

import { CollabDocManager } from "./doc-manager";

describe("CollabDocManager", () => {
  beforeEach(() => {
    shared.ensureCloudDocument.mockClear();
    shared.fetchDocumentSnapshot.mockClear();
    shared.providerInstances.splice(0, shared.providerInstances.length);
  });

  it("keeps local file content when the remote snapshot is still empty", async () => {
    const fileAdapter = {
      readFile: vi.fn(async () => ({
        path: "main.tex",
        language: "latex",
        content: "\\section{Intro}\nHello",
      })),
      saveFile: vi.fn(async () => undefined),
      readAsset: vi.fn(),
      readPdfBinary: vi.fn(async () => null),
      createFile: vi.fn(async () => undefined),
      createFolder: vi.fn(async () => undefined),
      deleteFile: vi.fn(async () => undefined),
      renameFile: vi.fn(async () => undefined),
    };

    const manager = new CollabDocManager({
      enabled: true,
      projectId: "project-1",
      authToken: "token",
      user: {
        userId: "user-1",
        name: "donk",
        color: "#4f8cff",
      },
      fileAdapter,
    });

    const handle = await manager.openDoc("main.tex");
    expect(handle?.yText.toString()).toBe("\\section{Intro}\nHello");

    expect(shared.providerInstances).toHaveLength(1);
    expect(shared.providerInstances[0].sendDocumentUpdate).toHaveBeenCalledTimes(1);

    const seededCalls = shared.providerInstances[0].sendDocumentUpdate.mock.calls as unknown as Array<[Uint8Array]>;
    const seededUpdate = seededCalls[0]?.[0];
    expect(seededUpdate).toBeInstanceOf(Uint8Array);
    if (!seededUpdate) {
      throw new Error("expected seeded update to be sent");
    }

    const seededDoc = new Y.Doc();
    Y.applyUpdate(seededDoc, seededUpdate);
    expect(seededDoc.getText("content").toString()).toBe("\\section{Intro}\nHello");
  });
});
