export function generateShareLink(projectId: string, httpBaseUrl: string): string {
  return `${httpBaseUrl}/join/${projectId}`;
}

export function parseShareLink(link: string): { projectId: string } | null {
  try {
    const url = new URL(link);
    const match = url.pathname.match(/\/join\/([a-f0-9-]+)/);
    if (!match) return null;
    return { projectId: match[1] };
  } catch {
    return null;
  }
}
