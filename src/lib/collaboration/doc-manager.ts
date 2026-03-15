import { Awareness } from "y-protocols/awareness.js";
import * as Y from "yjs";

import type { FileAdapter } from "../adapters";
import type { CollabMember, WorkspaceSnapshot } from "../../types";
import { ensureCloudDocument, fetchDocumentSnapshot } from "./cloud-api";
import { buildCollabWebSocketUrl } from "./auth";
import { ViewerLeafProvider } from "./yjs-provider";

const LOCAL_PERSISTENCE_ORIGIN = Symbol("viewerleaf-collab-persist");
const LOCAL_MIRROR_FLUSH_MS = 1000;
const LOCAL_STATE_FLUSH_MS = 600;

function collectTextPaths(nodes: WorkspaceSnapshot["tree"]) {
  const result: string[] = [];

  function visit(currentNodes: WorkspaceSnapshot["tree"]) {
    for (const node of currentNodes) {
      if (node.kind === "directory") {
        visit(node.children ?? []);
        continue;
      }
      if (node.isText) {
        result.push(node.path);
      }
    }
  }

  visit(nodes);
  return result;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function persistencePath(projectId: string, docPath: string) {
  const safe = encodeURIComponent(docPath);
  return `.viewerleaf/collab/${projectId}/${safe}.json`;
}

export interface ManagedCollabDocHandle {
  path: string;
  yDoc: Y.Doc;
  yText: Y.Text;
  awareness: Awareness;
  provider: ViewerLeafProvider;
  synced: boolean;
  connectionError: string;
  members: CollabMember[];
  flushLocalMirror(): Promise<void>;
  destroy(): void;
  subscribe(listener: () => void): () => void;
}

interface ManagedDocInternal extends ManagedCollabDocHandle {
  mirrorFlushTimer: number | null;
  stateFlushTimer: number | null;
  subscribers: Set<() => void>;
}

interface CollabDocManagerOptions {
  enabled: boolean;
  projectId: string | null;
  authToken: string;
  user: { userId: string; name: string; color: string };
  fileAdapter: FileAdapter;
}

export class CollabDocManager {
  private readonly options: CollabDocManagerOptions;
  private readonly docs = new Map<string, ManagedDocInternal>();
  private readonly listeners = new Set<() => void>();

  constructor(options: CollabDocManagerOptions) {
    this.options = options;
  }

  async syncProject(snapshot: WorkspaceSnapshot | null) {
    const nextPaths =
      snapshot && this.options.enabled && this.options.projectId
        ? new Set(collectTextPaths(snapshot.tree))
        : new Set<string>();

    for (const path of nextPaths) {
      if (!this.docs.has(path)) {
        await this.openDoc(path);
      }
    }

    for (const path of Array.from(this.docs.keys())) {
      if (!nextPaths.has(path)) {
        this.closeDoc(path);
      }
    }
  }

  async openDoc(path: string) {
    const existing = this.docs.get(path);
    if (existing) {
      return existing;
    }

    if (!this.options.enabled || !this.options.projectId) {
      return null;
    }

    const yDoc = new Y.Doc();
    const yText = yDoc.getText("content");
    const awareness = new Awareness(yDoc);

    const persistedUpdate = await this.readPersistedState(path);
    if (persistedUpdate?.length) {
      Y.applyUpdate(yDoc, persistedUpdate, LOCAL_PERSISTENCE_ORIGIN);
    } else {
      const remoteSnapshot = await this.fetchRemoteSnapshot(path);
      if (remoteSnapshot?.length) {
        Y.applyUpdate(yDoc, remoteSnapshot, LOCAL_PERSISTENCE_ORIGIN);
      } else {
        try {
          const localFile = await this.options.fileAdapter.readFile(path);
          if (localFile.content) {
            yDoc.transact(() => {
              yText.insert(0, localFile.content);
            }, LOCAL_PERSISTENCE_ORIGIN);
          }
        } catch (error) {
          console.warn("failed to seed collaborative doc from local content", path, error);
        }
      }
    }

    const provider = new ViewerLeafProvider(
      buildCollabWebSocketUrl(this.options.projectId, path, this.options.authToken),
      yDoc,
      awareness,
      this.options.authToken,
      this.options.user,
      path,
    );

    const managed: ManagedDocInternal = {
      path,
      yDoc,
      yText,
      awareness,
      provider,
      synced: false,
      connectionError: "",
      members: [],
      mirrorFlushTimer: null,
      stateFlushTimer: null,
      subscribers: new Set(),
      flushLocalMirror: async () => {
        await this.options.fileAdapter.saveFile(path, yText.toString());
      },
      destroy: () => {
        if (managed.mirrorFlushTimer !== null) {
          window.clearTimeout(managed.mirrorFlushTimer);
        }
        if (managed.stateFlushTimer !== null) {
          window.clearTimeout(managed.stateFlushTimer);
        }
        provider.destroy();
        yDoc.destroy();
      },
      subscribe: (listener: () => void) => {
        managed.subscribers.add(listener);
        return () => {
          managed.subscribers.delete(listener);
        };
      },
    };

    const notify = () => {
      const states = Array.from(awareness.getStates().entries());
      managed.members = states
        .filter(([clientId, state]) => clientId !== awareness.clientID && state?.user)
        .map(([clientId, state]) => ({
          clientId,
          userId: state.user.userId || String(clientId),
          name: state.user.name || "Anonymous",
          color: state.user.color || "#7a8cff",
          openFile: state.user.openFile,
        }));
      for (const listener of managed.subscribers) {
        listener();
      }
      for (const listener of this.listeners) {
        listener();
      }
    };

    provider.on("sync", () => {
      managed.synced = true;
      managed.connectionError = "";
      notify();
    });
    provider.on("status", (connected) => {
      if (!connected) {
        managed.synced = false;
      }
      notify();
    });
    provider.on("connection-error", (error) => {
      managed.connectionError = error.message;
      managed.synced = false;
      notify();
    });

    awareness.on("change", () => {
      notify();
    });

    yDoc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_PERSISTENCE_ORIGIN) {
        return;
      }

      if (managed.mirrorFlushTimer !== null) {
        window.clearTimeout(managed.mirrorFlushTimer);
      }
      managed.mirrorFlushTimer = window.setTimeout(() => {
        managed.mirrorFlushTimer = null;
        void managed.flushLocalMirror().catch((error) => {
          console.warn("failed to flush collaborative mirror", path, error);
        });
      }, LOCAL_MIRROR_FLUSH_MS);

      if (managed.stateFlushTimer !== null) {
        window.clearTimeout(managed.stateFlushTimer);
      }
      managed.stateFlushTimer = window.setTimeout(() => {
        managed.stateFlushTimer = null;
        void this.persistState(path, yDoc).catch((error) => {
          console.warn("failed to persist collaborative state", path, error);
        });
      }, LOCAL_STATE_FLUSH_MS);

      notify();
    });

    this.docs.set(path, managed);
    provider.connect();
    notify();
    return managed;
  }

  closeDoc(path: string) {
    const doc = this.docs.get(path);
    if (!doc) {
      return;
    }
    doc.destroy();
    this.docs.delete(path);
    for (const listener of this.listeners) {
      listener();
    }
  }

  getDoc(path: string) {
    return this.docs.get(path) ?? null;
  }

  getAllConnectedPaths() {
    return Array.from(this.docs.keys());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async flushAll() {
    await Promise.all(
      Array.from(this.docs.values()).map(async (doc) => {
        await doc.flushLocalMirror();
        await this.persistState(doc.path, doc.yDoc);
      }),
    );
  }

  destroy() {
    for (const path of Array.from(this.docs.keys())) {
      this.closeDoc(path);
    }
  }

  private async fetchRemoteSnapshot(path: string) {
    if (!this.options.projectId) {
      return null;
    }

    try {
      await ensureCloudDocument(this.options.authToken, this.options.projectId, path);
      return await fetchDocumentSnapshot(this.options.authToken, this.options.projectId, path);
    } catch (error) {
      console.warn("failed to fetch remote snapshot", path, error);
      return null;
    }
  }

  private async readPersistedState(path: string) {
    if (!this.options.projectId) {
      return null;
    }

    try {
      const file = await this.options.fileAdapter.readFile(persistencePath(this.options.projectId, path));
      const parsed = JSON.parse(file.content) as { updateBase64?: string };
      return parsed.updateBase64 ? fromBase64(parsed.updateBase64) : null;
    } catch {
      return null;
    }
  }

  private async persistState(path: string, yDoc: Y.Doc) {
    if (!this.options.projectId) {
      return;
    }

    await this.ensurePersistenceDirectories();
    const payload = JSON.stringify({
      updatedAt: new Date().toISOString(),
      updateBase64: toBase64(Y.encodeStateAsUpdate(yDoc)),
    });
    await this.options.fileAdapter.saveFile(persistencePath(this.options.projectId, path), payload);
  }

  private async ensurePersistenceDirectories() {
    if (!this.options.projectId) {
      return;
    }

    const folders = [
      ".viewerleaf",
      ".viewerleaf/collab",
      `.viewerleaf/collab/${this.options.projectId}`,
    ];
    for (const folder of folders) {
      try {
        await this.options.fileAdapter.createFolder(folder);
      } catch {
        // Folder may already exist. Persist writes should still proceed.
      }
    }
  }
}
