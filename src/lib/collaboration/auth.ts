import { resolveCollabUrls } from "./collab-config";

export interface CollabAuthSession {
  token: string;
  userId: string;
  email?: string;
  name: string;
  color: string;
}

const COLLAB_AUTH_STORAGE_KEY = "viewerleaf:collab-auth:v1";

function readStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(COLLAB_AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readCollabAuthSession(): CollabAuthSession | null {
  const raw = readStorage();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CollabAuthSession>;
    if (!parsed.token || !parsed.userId || !parsed.name) {
      return null;
    }
    return {
      token: parsed.token,
      userId: parsed.userId,
      email: parsed.email,
      name: parsed.name,
      color: parsed.color?.trim() || "#7a8cff",
    };
  } catch {
    return null;
  }
}

export function writeCollabAuthSession(session: CollabAuthSession | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(COLLAB_AUTH_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(COLLAB_AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function resolveCollabBaseUrls() {
  return resolveCollabUrls();
}

export function buildCollabWebSocketUrl(projectId: string, docPath: string, token: string) {
  const { wsBaseUrl } = resolveCollabBaseUrls();
  const url = new URL(`${wsBaseUrl}/api/projects/${projectId}/ws`);
  url.searchParams.set("path", docPath);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

