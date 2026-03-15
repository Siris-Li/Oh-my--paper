export interface CollabConfig {
  httpBaseUrl: string;
  wsBaseUrl: string;
  teamLabel: string;
}

const STORAGE_KEY = "viewerleaf:collab-config:v1";

export function readCollabConfig(): CollabConfig | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CollabConfig>;
    if (!parsed.httpBaseUrl || !parsed.wsBaseUrl) return null;
    return {
      httpBaseUrl: parsed.httpBaseUrl.replace(/\/$/, ""),
      wsBaseUrl: parsed.wsBaseUrl.replace(/\/$/, ""),
      teamLabel: parsed.teamLabel?.trim() || "",
    };
  } catch {
    return null;
  }
}

export function writeCollabConfig(config: CollabConfig | null): void {
  if (typeof window === "undefined") return;
  if (!config) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function resolveCollabUrls(): { httpBaseUrl: string; wsBaseUrl: string } {
  const stored = readCollabConfig();
  if (stored?.httpBaseUrl && stored?.wsBaseUrl) {
    return { httpBaseUrl: stored.httpBaseUrl, wsBaseUrl: stored.wsBaseUrl };
  }
  const httpBaseUrl = (import.meta.env.VITE_VIEWERLEAF_COLLAB_HTTP_URL as string | undefined)?.trim() || "";
  const wsBaseUrl = (import.meta.env.VITE_VIEWERLEAF_COLLAB_WS_URL as string | undefined)?.trim() || "";
  return {
    httpBaseUrl: httpBaseUrl.replace(/\/$/, ""),
    wsBaseUrl: wsBaseUrl.replace(/\/$/, ""),
  };
}
