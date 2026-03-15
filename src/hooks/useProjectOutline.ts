import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";

import { buildProjectOutline, type OutlineHeading, type OutlineNode } from "../lib/outline";
import type { ProjectFile, WorkspaceSnapshot } from "../types";

interface UseProjectOutlineParams {
  snapshot: WorkspaceSnapshot | null;
  openFiles: Record<string, ProjectFile>;
  draftContentRef: MutableRefObject<Record<string, string>>;
  readFile: (path: string) => Promise<ProjectFile>;
  revision?: number;
}

interface OutlineState {
  outlineHeadings: OutlineHeading[];
  outlineTree: OutlineNode[];
  outlineWarnings: string[];
  outlineLoading: boolean;
}

export function useProjectOutline({
  snapshot,
  openFiles,
  draftContentRef,
  readFile,
  revision = 0,
}: UseProjectOutlineParams): OutlineState {
  const [outlineHeadings, setOutlineHeadings] = useState<OutlineHeading[]>([]);
  const [outlineTree, setOutlineTree] = useState<OutlineNode[]>([]);
  const [outlineWarnings, setOutlineWarnings] = useState<string[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);

  useEffect(() => {
    if (!snapshot?.projectConfig.rootPath) {
      setOutlineHeadings([]);
      setOutlineTree([]);
      setOutlineWarnings([]);
      setOutlineLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      setOutlineLoading(true);

      void (async () => {
        try {
          const result = await buildProjectOutline(snapshot.projectConfig.mainTex, async (path) => {
            const draftContent = draftContentRef.current[path];
            if (typeof draftContent === "string") {
              return draftContent;
            }
            const openFile = openFiles[path];
            if (openFile) {
              return openFile.content;
            }
            return (await readFile(path)).content;
          });

          if (cancelled) {
            return;
          }

          if (result.warnings.length > 0) {
            console.warn("outline warnings", result.warnings);
          }

          setOutlineHeadings(result.headings);
          setOutlineTree(result.tree);
          setOutlineWarnings(result.warnings);
        } catch (error) {
          if (cancelled) {
            return;
          }

          console.warn("failed to build outline", error);
          setOutlineHeadings([]);
          setOutlineTree([]);
          setOutlineWarnings([error instanceof Error ? error.message : String(error)]);
        } finally {
          if (!cancelled) {
            setOutlineLoading(false);
          }
        }
      })();
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draftContentRef, openFiles, readFile, revision, snapshot?.projectConfig.mainTex, snapshot?.projectConfig.rootPath]);

  return {
    outlineHeadings,
    outlineTree,
    outlineWarnings,
    outlineLoading,
  };
}
