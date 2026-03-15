import { LocalDesktopAdapter } from "./local-desktop";

export * from "./types";
export { LocalDesktopAdapter };

export function createLocalAdapter() {
  const adapter = new LocalDesktopAdapter();
  return {
    file: adapter,
    project: adapter,
    compile: adapter,
  };
}

