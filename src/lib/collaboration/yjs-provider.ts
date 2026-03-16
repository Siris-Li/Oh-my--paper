import * as awarenessProtocol from "y-protocols/awareness.js";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const FRAME_SYNC_REQUEST = 0;
const FRAME_SYNC_RESPONSE = 1;
const FRAME_DOCUMENT_UPDATE = 2;
const FRAME_AWARENESS_UPDATE = 3;

type ProviderEventMap = {
  sync: () => void;
  "connection-error": (error: Error) => void;
  status: (connected: boolean) => void;
  reconnecting: (attempt: number, delay: number) => void;
};

function encodeFrame(type: number, payload?: Uint8Array) {
  const bytes = payload ?? new Uint8Array(0);
  const frame = new Uint8Array(bytes.length + 1);
  frame[0] = type;
  frame.set(bytes, 1);
  return frame;
}

function decodeFrame(message: ArrayBuffer | ArrayBufferView) {
  const bytes = message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  return {
    type: bytes[0] ?? -1,
    payload: bytes.slice(1),
  };
}

export class ViewerLeafProvider {
  private readonly wsUrl: string;
  private readonly yDoc: Y.Doc;
  readonly awareness: Awareness;
  private readonly authToken: string;
  private readonly user: { userId: string; name: string; color: string };
  private readonly docPath: string;
  private ws: WebSocket | null = null;
  private listeners = new Map<keyof ProviderEventMap, Set<(...args: unknown[]) => void>>();
  private heartbeatTimer: number | null = null;
  private syncedState = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private static readonly MAX_DELAY = 30_000;
  private static readonly BASE_DELAY = 1_000;

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(encodeFrame(FRAME_DOCUMENT_UPDATE, update));
  };

  private readonly handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const changedClients = [...added, ...updated, ...removed];
    if (!changedClients.length) {
      return;
    }
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
    this.ws.send(encodeFrame(FRAME_AWARENESS_UPDATE, update));
  };

  constructor(
    wsUrl: string,
    yDoc: Y.Doc,
    awareness: Awareness,
    authToken: string,
    user: { userId: string; name: string; color: string },
    docPath: string,
  ) {
    this.wsUrl = wsUrl;
    this.yDoc = yDoc;
    this.awareness = awareness;
    this.authToken = authToken;
    this.user = user;
    this.docPath = docPath;
    this.yDoc.on("update", this.handleDocumentUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  get synced() {
    return this.syncedState;
  }

  sendDocumentUpdate(update: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(encodeFrame(FRAME_DOCUMENT_UPDATE, update));
    return true;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    this.syncedState = false;
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", this.handleOpen);
    ws.addEventListener("message", this.handleMessage);
    ws.addEventListener("close", this.handleClose);
    ws.addEventListener("error", this.handleError);
    this.ws = ws;
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (!this.ws) {
      return;
    }

    this.ws.removeEventListener("open", this.handleOpen);
    this.ws.removeEventListener("message", this.handleMessage);
    this.ws.removeEventListener("close", this.handleClose);
    this.ws.removeEventListener("error", this.handleError);
    this.ws.close();
    this.ws = null;
    this.syncedState = false;
    this.emit("status", false);
  }

  destroy() {
    this.disconnect();
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.yDoc.off("update", this.handleDocumentUpdate);
    this.awareness.setLocalState(null);
    this.reconnectAttempt = 0;
  }

  on<EventName extends keyof ProviderEventMap>(event: EventName, cb: ProviderEventMap[EventName]) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as (...args: unknown[]) => void);
    this.listeners.set(event, set);
  }

  off<EventName extends keyof ProviderEventMap>(event: EventName, cb: ProviderEventMap[EventName]) {
    this.listeners.get(event)?.delete(cb as (...args: unknown[]) => void);
  }

  private readonly handleOpen = () => {
    if (!this.ws) {
      return;
    }

    this.reconnectAttempt = 0;
    this.emit("status", true);
    this.ws.send(
      JSON.stringify({
        type: "join",
        userId: this.user.userId,
        clientId: this.yDoc.clientID,
        name: this.user.name,
        color: this.user.color,
        openFile: this.docPath,
        token: this.authToken,
      }),
    );
    this.awareness.setLocalStateField("user", {
      userId: this.user.userId,
      name: this.user.name,
      color: this.user.color,
      colorLight: `${this.user.color}33`,
      openFile: this.docPath,
    });
    this.ws.send(encodeFrame(FRAME_SYNC_REQUEST, Y.encodeStateVector(this.yDoc)));
    this.sendAwarenessPing();
    this.startHeartbeat();
  };

  private readonly handleMessage = (event: MessageEvent<string | ArrayBuffer>) => {
    if (typeof event.data === "string") {
      try {
        const payload = JSON.parse(event.data) as { type?: string; message?: string };
        if (payload.type === "error") {
          this.emit("connection-error", new Error(payload.message || "Connection failed"));
        }
      } catch (error) {
        this.emit("connection-error", error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    const { type, payload } = decodeFrame(event.data);
    switch (type) {
      case FRAME_SYNC_RESPONSE:
      case FRAME_DOCUMENT_UPDATE:
        Y.applyUpdate(this.yDoc, payload, this);
        if (!this.syncedState) {
          this.syncedState = true;
          this.emit("sync");
        }
        break;
      case FRAME_AWARENESS_UPDATE:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, this);
        break;
      default:
        this.emit("connection-error", new Error("Unknown collaboration frame"));
    }
  };

  private readonly handleClose = () => {
    this.stopHeartbeat();
    this.ws = null;
    this.syncedState = false;
    this.emit("status", false);
    this.scheduleReconnect();
  };

  private readonly handleError = () => {
    this.emit("connection-error", new Error("WebSocket connection error"));
  };

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.sendAwarenessPing();
    }, 15_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendAwarenessPing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const clientIds = [this.awareness.clientID];
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds);
    this.ws.send(encodeFrame(FRAME_AWARENESS_UPDATE, update));
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    const delay = Math.min(
      ViewerLeafProvider.BASE_DELAY * 2 ** this.reconnectAttempt,
      ViewerLeafProvider.MAX_DELAY,
    );
    this.reconnectAttempt++;
    this.emit("reconnecting", this.reconnectAttempt, delay);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emit<EventName extends keyof ProviderEventMap>(
    event: EventName,
    ...args: Parameters<ProviderEventMap[EventName]>
  ) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}
