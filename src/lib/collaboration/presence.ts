import type { Extension } from "@codemirror/state";
import type { Awareness } from "y-protocols/awareness";

function toLightColor(color: string) {
  return `${color}33`;
}

export function createPresenceExtension(
  awareness: Awareness,
  user: { userId?: string; name: string; color: string; openFile?: string },
): Extension {
  awareness.setLocalStateField("user", {
    userId: user.userId,
    name: user.name,
    color: user.color,
    colorLight: toLightColor(user.color),
    openFile: user.openFile,
  });
  return [];
}

