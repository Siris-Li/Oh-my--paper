import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { closePathTab, findFirstTextPath, getNodeByPath } from "../lib/workspace";
import type { FileAdapter } from "../lib/adapters";
import type { AssetResource, ProjectFile, ProjectNode, WorkspaceSnapshot } from "../types";

type EditorJumpTarget = { path: string; line: number; nonce: number };
const WORKSPACE_DEBUG_LOG_LIMIT = 240;

function formatDebugTimestamp(date: Date) {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function serializeDebugDetails(details: unknown) {
  if (details == null) {
    return "";
  }
  if (typeof details === "string") {
    return details;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function buildDebugLine(level: "info" | "warn" | "error", message: string, details?: unknown) {
  const timestamp = formatDebugTimestamp(new Date());
  const detailText = serializeDebugDetails(details);
  return detailText.length > 0
    ? `[${timestamp}] [${level.toUpperCase()}] ${message} ${detailText}`
    : `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function isTextNode(node: ProjectNode | null) {
  return Boolean(node?.kind !== "directory" && node?.isText);
}

function pickActiveTextPath(snapshot: WorkspaceSnapshot, requestedPath: string, previousPath: string) {
  const candidates = [requestedPath, previousPath, snapshot.activeFile, findFirstTextPath(snapshot.tree)];
  return candidates.find((path) => path && isTextNode(getNodeByPath(snapshot.tree, path))) ?? "";
}

function sanitizeOpenTabs(snapshot: WorkspaceSnapshot, openTabs: string[], activePath: string) {
  const nextTabs = Array.from(
    new Set(openTabs.filter((path) => isTextNode(getNodeByPath(snapshot.tree, path)))),
  );

  if (activePath && !nextTabs.includes(activePath)) {
    nextTabs.unshift(activePath);
  }

  return nextTabs;
}

interface UseWorkspaceFilesParams {
  snapshot: WorkspaceSnapshot | null;
  fileAdapter: FileAdapter;
}

interface ResetWorkspaceFilesOptions {
  nextSnapshot: WorkspaceSnapshot;
  options?: {
    activeFilePath?: string;
    openTabs?: string[];
    openImageTabs?: string[];
    editorImagePath?: string;
    clearCaches?: boolean;
  };
}

export interface WorkspaceFilesState {
  openFiles: Record<string, ProjectFile>;
  openTabs: string[];
  openImageTabs: string[];
  dirtyPaths: string[];
  assetCache: Record<string, AssetResource>;
  fileLoadErrors: Record<string, string>;
  assetLoadErrors: Record<string, string>;
  debugLogLines: string[];
  activeFilePath: string;
  loadingFilePath: string;
  editorImagePath: string;
  editorImageUrl: string;
  draftContentRef: MutableRefObject<Record<string, string>>;
  activeFile: ProjectFile | null;
  dirtyPathSet: Set<string>;
  openImageTabSet: Set<string>;
  editorTabs: string[];
  setOpenFiles: Dispatch<SetStateAction<Record<string, ProjectFile>>>;
  setOpenTabs: Dispatch<SetStateAction<string[]>>;
  setOpenImageTabs: Dispatch<SetStateAction<string[]>>;
  setDirtyPaths: Dispatch<SetStateAction<string[]>>;
  setAssetCache: Dispatch<SetStateAction<Record<string, AssetResource>>>;
  setActiveFilePath: Dispatch<SetStateAction<string>>;
  setEditorImagePath: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string>>;
  loadTextFile: (path: string) => Promise<ProjectFile | null>;
  loadAsset: (path: string) => Promise<AssetResource | null>;
  saveOpenFiles: (paths: string[]) => Promise<string[]>;
  replaceFileContent: (path: string, content: string) => void;
  handleFileChange: (path: string, content: string) => void;
  addDirtyPath: (path: string) => void;
  openTextFile: (path: string, line?: number) => { jumpTarget?: EditorJumpTarget };
  openImageFile: (path: string) => void;
  closeImageTab: (path: string) => void;
  resetForSnapshot: (args: ResetWorkspaceFilesOptions) => void;
}

export function useWorkspaceFiles({ snapshot, fileAdapter }: UseWorkspaceFilesParams): WorkspaceFilesState {
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [openImageTabs, setOpenImageTabs] = useState<string[]>([]);
  const [openFiles, setOpenFiles] = useState<Record<string, ProjectFile>>({});
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const [assetCache, setAssetCache] = useState<Record<string, AssetResource>>({});
  const [fileLoadErrors, setFileLoadErrors] = useState<Record<string, string>>({});
  const [assetLoadErrors, setAssetLoadErrors] = useState<Record<string, string>>({});
  const [debugLogLines, setDebugLogLines] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [loadingFilePath, setLoadingFilePath] = useState("");
  const [editorImagePath, setEditorImagePath] = useState("");
  const [editorImageUrl, setEditorImageUrl] = useState("");

  const draftContentRef = useRef<Record<string, string>>({});
  const pendingTextLoadsRef = useRef<Record<string, Promise<ProjectFile | null>>>({});
  const jumpNonceRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  const openTabsRef = useRef(openTabs);
  const openImageTabsRef = useRef(openImageTabs);
  const openFilesRef = useRef(openFiles);
  const dirtyPathsRef = useRef(dirtyPaths);
  const assetCacheRef = useRef(assetCache);
  const activeFilePathRef = useRef(activeFilePath);
  const editorImagePathRef = useRef(editorImagePath);
  const lastLoggedActivePathRef = useRef("");
  const lastLoggedLoadingPathRef = useRef("");

  const activeFile = (() => {
    if (!activeFilePath) {
      return null;
    }
    const file = openFiles[activeFilePath];
    if (!file) {
      return null;
    }
    const draftContent = draftContentRef.current[activeFilePath];
    if (draftContent === undefined || draftContent === file.content) {
      return file;
    }
    return { ...file, content: draftContent };
  })();

  const dirtyPathSet = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);
  const openImageTabSet = useMemo(() => new Set(openImageTabs), [openImageTabs]);
  const editorTabs = useMemo(
    () => Array.from(new Set([...openTabs, ...openImageTabs])),
    [openImageTabs, openTabs],
  );

  const logWorkspaceDebug = useCallback((level: "info" | "warn" | "error", message: string, details?: unknown) => {
    const line = buildDebugLine(level, message, details);
    setDebugLogLines((current) => {
      const next = [...current, line];
      return next.length > WORKSPACE_DEBUG_LOG_LIMIT ? next.slice(next.length - WORKSPACE_DEBUG_LOG_LIMIT) : next;
    });
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    openImageTabsRef.current = openImageTabs;
  }, [openImageTabs]);

  useEffect(() => {
    openFilesRef.current = openFiles;
  }, [openFiles]);

  useEffect(() => {
    dirtyPathsRef.current = dirtyPaths;
  }, [dirtyPaths]);

  useEffect(() => {
    assetCacheRef.current = assetCache;
  }, [assetCache]);

  useEffect(() => {
    activeFilePathRef.current = activeFilePath;
  }, [activeFilePath]);

  useEffect(() => {
    editorImagePathRef.current = editorImagePath;
  }, [editorImagePath]);

  const loadTextFile = useCallback(async (path: string) => {
    if (!path) {
      return null;
    }

    const existing = openFilesRef.current[path];
    if (existing) {
      const draftContent = draftContentRef.current[path];
      return draftContent === undefined || draftContent === existing.content
        ? existing
        : { ...existing, content: draftContent };
    }

    const pending = pendingTextLoadsRef.current[path];
    if (pending) {
      return pending;
    }

    logWorkspaceDebug("info", "[editor] start loading text file", { path });
    setFileLoadErrors((current) => {
      if (!(path in current)) {
        return current;
      }
      const next = { ...current };
      delete next[path];
      return next;
    });
    setLoadingFilePath(path);
    const request = (async () => {
      try {
        const file = await fileAdapter.readFile(path);
        draftContentRef.current[path] = file.content;
        setOpenFiles((current) => ({ ...current, [path]: file }));
        logWorkspaceDebug("info", "[editor] loaded text file", {
          path,
          chars: file.content.length,
          lines: file.content.split("\n").length,
        });
        return file;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFileLoadErrors((current) => (current[path] === message ? current : { ...current, [path]: message }));
        logWorkspaceDebug("error", "[editor] failed to load text file", {
          path,
          reason: message,
        });
        return null;
      } finally {
        delete pendingTextLoadsRef.current[path];
        setLoadingFilePath((current) => (current === path ? "" : current));
      }
    })();

    pendingTextLoadsRef.current[path] = request;
    return request;
  }, [fileAdapter, logWorkspaceDebug]);

  const loadAsset = useCallback(async (path: string) => {
    if (!path || assetCacheRef.current[path]) {
      return assetCacheRef.current[path] ?? null;
    }

    try {
      logWorkspaceDebug("info", "[preview] start loading asset", { path });
      const asset = await fileAdapter.readAsset(path);
      setAssetCache((current) => ({ ...current, [path]: asset }));
      setAssetLoadErrors((current) => {
        if (!(path in current)) {
          return current;
        }
        const next = { ...current };
        delete next[path];
        return next;
      });
      logWorkspaceDebug("info", "[preview] loaded asset", {
        path,
        bytes: asset.data instanceof Uint8Array ? asset.data.length : asset.size,
        mimeType: asset.mimeType,
      });
      return asset;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("failed to load asset", path, error);
      setAssetLoadErrors((current) => (current[path] === message ? current : { ...current, [path]: message }));
      logWorkspaceDebug("error", "[preview] failed to load asset", {
        path,
        reason: message,
      });
      return null;
    }
  }, [fileAdapter, logWorkspaceDebug]);

  const saveOpenFiles = useCallback(async (paths: string[]) => {
    const targets = Array.from(
      new Set(
        paths.filter((path) => {
          const file = openFilesRef.current[path];
          return Boolean(file && dirtyPathsRef.current.includes(path));
        }),
      ),
    );

    const savedContents: Array<{ path: string; content: string }> = [];

    for (const path of targets) {
      const file = openFilesRef.current[path];
      if (!file) {
        continue;
      }
      const content = draftContentRef.current[path] ?? file.content;
      await fileAdapter.saveFile(path, content);
      savedContents.push({ path, content });
    }

    if (savedContents.length > 0) {
      setOpenFiles((current) => {
        let changed = false;
        const next = { ...current };
        for (const { path, content } of savedContents) {
          const file = next[path];
          if (!file || file.content === content) {
            continue;
          }
          next[path] = { ...file, content };
          changed = true;
        }
        return changed ? next : current;
      });
      setDirtyPaths((current) =>
        current.filter((path) => !savedContents.some((saved) => saved.path === path)),
      );
    }

    return savedContents.map((saved) => saved.path);
  }, [fileAdapter]);

  const replaceFileContent = useCallback((filePath: string, content: string) => {
    draftContentRef.current[filePath] = content;
    setOpenFiles((current) => {
      const file = current[filePath];
      if (!file) {
        return current;
      }
      return {
        ...current,
        [filePath]: {
          ...file,
          content,
        },
      };
    });
  }, []);

  const addDirtyPath = useCallback((path: string) => {
    setDirtyPaths((current) => (current.includes(path) ? current : [...current, path]));
  }, []);

  const handleFileChange = useCallback((path: string, content: string) => {
    draftContentRef.current[path] = content;
    addDirtyPath(path);
  }, [addDirtyPath]);

  const openTextFile = useCallback((path: string, line?: number) => {
    logWorkspaceDebug("info", "[editor] request open text tab", {
      path,
      line: line ?? null,
    });
    setEditorImagePath("");
    setEditorImageUrl("");
    startTransition(() => {
      setActiveFilePath(path);
      setOpenTabs((current) => (current.includes(path) ? current : [...current, path]));
    });
    void loadTextFile(path);

    if (!line) {
      return {};
    }

    jumpNonceRef.current += 1;
    return {
      jumpTarget: {
        path,
        line,
        nonce: jumpNonceRef.current,
      },
    };
  }, [loadTextFile, logWorkspaceDebug]);

  const openImageFile = useCallback((path: string) => {
    logWorkspaceDebug("info", "[editor] request open image tab", { path });
    startTransition(() => {
      setEditorImagePath(path);
      setOpenImageTabs((current) => (current.includes(path) ? current : [...current, path]));
    });
    void loadAsset(path);
  }, [loadAsset, logWorkspaceDebug]);

  const closeImageTab = useCallback((path: string) => {
    const closed = closePathTab(openImageTabsRef.current, editorImagePathRef.current, path);
    setOpenImageTabs(closed.openTabs);
    setEditorImagePath(closed.activePath);
  }, []);

  const resetForSnapshot = useCallback(({ nextSnapshot, options }: ResetWorkspaceFilesOptions) => {
    const rootChanged =
      options?.clearCaches ||
      nextSnapshot.projectConfig.rootPath !== (snapshotRef.current?.projectConfig.rootPath ?? "");
    const nextActivePath = pickActiveTextPath(
      nextSnapshot,
      options?.activeFilePath ?? "",
      activeFilePathRef.current,
    );
    const nextTabs = sanitizeOpenTabs(nextSnapshot, options?.openTabs ?? openTabsRef.current, nextActivePath);
    const requestedImagePath = options?.editorImagePath ?? editorImagePathRef.current;
    const nextImageTabs = Array.from(
      new Set(
        (options?.openImageTabs ?? openImageTabsRef.current).filter((path) => {
          const node = getNodeByPath(nextSnapshot.tree, path);
          return Boolean(node && node.kind !== "directory" && node.fileType === "image");
        }),
      ),
    );

    if (requestedImagePath) {
      const node = getNodeByPath(nextSnapshot.tree, requestedImagePath);
      if (node && node.kind !== "directory" && node.fileType === "image" && !nextImageTabs.includes(requestedImagePath)) {
        nextImageTabs.unshift(requestedImagePath);
      }
    }

    const nextEditorImagePath =
      requestedImagePath && nextImageTabs.includes(requestedImagePath) ? requestedImagePath : "";

    setOpenTabs(nextTabs);
    setOpenImageTabs(nextImageTabs);
    setActiveFilePath(nextActivePath);
    setLoadingFilePath("");
    setEditorImagePath(nextEditorImagePath);
    setEditorImageUrl("");

    if (rootChanged) {
      draftContentRef.current = {};
      pendingTextLoadsRef.current = {};
      setFileLoadErrors({});
      setAssetLoadErrors({});
      setDebugLogLines([
        buildDebugLine("info", "[workspace] reset file state for new snapshot", {
          rootChanged,
          rootPath: nextSnapshot.projectConfig.rootPath,
          activePath: nextActivePath || null,
          openTabs: nextTabs.length,
          openImageTabs: nextImageTabs.length,
        }),
      ]);
    } else {
      draftContentRef.current = Object.fromEntries(
        nextTabs
          .map((path) => [path, draftContentRef.current[path]] as const)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    }

    setDirtyPaths((current) =>
      rootChanged
        ? []
        : current.filter((path) => nextTabs.includes(path) && isTextNode(getNodeByPath(nextSnapshot.tree, path))),
    );
    setOpenFiles((current) =>
      rootChanged
        ? {}
        : Object.fromEntries(Object.entries(current).filter(([path]) => nextTabs.includes(path))),
    );
    setAssetCache((current) =>
      rootChanged
        ? {}
        : Object.fromEntries(
          Object.entries(current).filter(([path]) => getNodeByPath(nextSnapshot.tree, path)),
        ),
    );
    if (!rootChanged) {
      logWorkspaceDebug("info", "[workspace] refreshed file state for snapshot", {
        rootChanged,
        rootPath: nextSnapshot.projectConfig.rootPath,
        activePath: nextActivePath || null,
        openTabs: nextTabs.length,
        openImageTabs: nextImageTabs.length,
      });
    }
  }, [logWorkspaceDebug]);

  useEffect(() => {
    if (activeFilePath === lastLoggedActivePathRef.current) {
      return;
    }
    lastLoggedActivePathRef.current = activeFilePath;
    logWorkspaceDebug("info", "[editor] active text path changed", {
      path: activeFilePath || null,
    });
  }, [activeFilePath, logWorkspaceDebug]);

  useEffect(() => {
    if (loadingFilePath === lastLoggedLoadingPathRef.current) {
      return;
    }
    lastLoggedLoadingPathRef.current = loadingFilePath;
    logWorkspaceDebug("info", "[editor] loading target changed", {
      path: loadingFilePath || null,
    });
  }, [loadingFilePath, logWorkspaceDebug]);

  useEffect(() => {
    if (!snapshot || !activeFilePath || openFiles[activeFilePath] || fileLoadErrors[activeFilePath]) {
      return;
    }
    const node = getNodeByPath(snapshot.tree, activeFilePath);
    if (node?.isText) {
      void loadTextFile(activeFilePath);
    }
  }, [activeFilePath, fileLoadErrors, loadTextFile, openFiles, snapshot]);

  useEffect(() => {
    if (!editorImagePath || assetCache[editorImagePath] || assetLoadErrors[editorImagePath]) {
      return;
    }
    void loadAsset(editorImagePath);
  }, [assetCache, assetLoadErrors, editorImagePath, loadAsset]);

  useEffect(() => {
    const editorImageAsset = editorImagePath ? assetCache[editorImagePath] : undefined;
    if (!editorImagePath || !editorImageAsset) {
      setEditorImageUrl("");
      return;
    }
    if (editorImageAsset.data instanceof Uint8Array && editorImageAsset.data.length > 0) {
      const blob = new Blob([editorImageAsset.data as BlobPart], {
        type: editorImageAsset.mimeType || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      setEditorImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setEditorImageUrl(editorImageAsset.resourceUrl ?? editorImageAsset.absolutePath);
  }, [assetCache, editorImagePath]);

  return {
    openFiles,
    openTabs,
    openImageTabs,
    dirtyPaths,
    assetCache,
    fileLoadErrors,
    assetLoadErrors,
    debugLogLines,
    activeFilePath,
    loadingFilePath,
    editorImagePath,
    editorImageUrl,
    draftContentRef,
    activeFile,
    dirtyPathSet,
    openImageTabSet,
    editorTabs,
    setOpenFiles,
    setOpenTabs,
    setOpenImageTabs,
    setDirtyPaths,
    setAssetCache,
    setActiveFilePath,
    setEditorImagePath,
    setEditorImageUrl,
    loadTextFile,
    loadAsset,
    saveOpenFiles,
    replaceFileContent,
    handleFileChange,
    addDirtyPath,
    openTextFile,
    openImageFile,
    closeImageTab,
    resetForSnapshot,
  };
}
