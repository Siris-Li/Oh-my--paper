import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";

import type { AppLocale, LiteratureItem } from "../types";
import { desktop } from "../lib/desktop";

/* ── Tiny helpers ── */
const t = (locale: AppLocale, zh: string, en: string) =>
  locale === "zh-CN" ? zh : en;

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function fileExtension(path: string) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

function generateId() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

/* ── Paper bank paper shape (loose, supports various field names) ── */
interface PaperEntry {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  abstract?: string;
  journal?: string;
  url?: string;
  link?: string;
  tags?: string[];
  notes?: string;
  [key: string]: unknown;
}

function extractPapers(parsed: unknown): PaperEntry[] | null {
  if (Array.isArray(parsed)) {
    return parsed as PaperEntry[];
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.papers)) {
      return obj.papers as PaperEntry[];
    }
    if (Array.isArray(obj.items)) {
      return obj.items as PaperEntry[];
    }
    if (Array.isArray(obj.references)) {
      return obj.references as PaperEntry[];
    }
  }
  return null;
}

/* ── Props ── */
interface ArtifactPreviewModalProps {
  path: string;
  locale: AppLocale;
  onClose: () => void;
  onOpenLiterature: () => void;
}

/* ── Component ── */
export function ArtifactPreviewModal({
  path,
  locale,
  onClose,
  onOpenLiterature,
}: ArtifactPreviewModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importedDois, setImportedDois] = useState<Set<string>>(new Set());
  const [importedTitles, setImportedTitles] = useState<Set<string>>(new Set());
  const [importingAll, setImportingAll] = useState(false);

  const ext = fileExtension(path);
  const name = basename(path);
  const isPaperBank = name.toLowerCase().includes("paper_bank");

  /* Load file content */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    desktop
      .readFile(path)
      .then((file) => {
        if (!cancelled) {
          setContent(file.content);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  /* Pre-load existing library for dedup */
  useEffect(() => {
    if (!isPaperBank) return;
    desktop.listLiterature().then((items) => {
      setImportedDois(new Set(items.filter((i) => i.doi).map((i) => i.doi)));
      setImportedTitles(new Set(items.map((i) => i.title.toLowerCase().trim())));
    }).catch(() => { /* ignore */ });
  }, [isPaperBank]);

  /* Parsed JSON / papers */
  const parsedJson = useMemo(() => {
    if (ext !== "json" || !content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }, [ext, content]);

  const papers = useMemo(() => {
    if (!parsedJson) return null;
    return extractPapers(parsedJson);
  }, [parsedJson]);

  const isPaperAlreadyImported = useCallback(
    (paper: PaperEntry) => {
      if (paper.doi && importedDois.has(paper.doi)) return true;
      if (paper.title && importedTitles.has(paper.title.toLowerCase().trim())) return true;
      return false;
    },
    [importedDois, importedTitles],
  );

  const handleImportPaper = useCallback(
    async (paper: PaperEntry) => {
      const item: LiteratureItem = {
        id: generateId(),
        title: paper.title ?? "Untitled",
        authors: paper.authors ?? [],
        year: paper.year ?? 0,
        journal: paper.journal ?? "",
        doi: paper.doi ?? "",
        abstract: paper.abstract ?? "",
        tags: paper.tags ?? [],
        notes: paper.notes ?? "",
        dedupHash: "",
        linkedTaskIds: [],
        addedAt: "",
        updatedAt: "",
      };
      try {
        await desktop.addLiterature(item);
        if (paper.doi) {
          setImportedDois((prev) => new Set(prev).add(paper.doi!));
        }
        if (paper.title) {
          setImportedTitles((prev) => new Set(prev).add(paper.title!.toLowerCase().trim()));
        }
      } catch (err) {
        console.error("Failed to import paper:", err);
      }
    },
    [],
  );

  const handleImportAll = useCallback(async () => {
    if (!papers) return;
    setImportingAll(true);
    const toImport = papers.filter((p) => !isPaperAlreadyImported(p));
    for (const paper of toImport) {
      await handleImportPaper(paper);
    }
    setImportingAll(false);
  }, [papers, isPaperAlreadyImported, handleImportPaper]);

  /* Close on Escape */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  /* ── Render body ── */
  function renderBody() {
    if (loading) {
      return (
        <div className="artifact-preview-modal__loading">
          {t(locale, "加载中…", "Loading…")}
        </div>
      );
    }
    if (error) {
      return (
        <div className="artifact-preview-modal__error">
          <p>{t(locale, "无法加载文件", "Failed to load file")}</p>
          <p className="artifact-preview-modal__error-detail">{error}</p>
        </div>
      );
    }
    if (!content && content !== "") {
      return null;
    }

    /* Markdown */
    if (ext === "md") {
      return (
        <div className="artifact-preview-modal__markdown">
          <Markdown>{content}</Markdown>
        </div>
      );
    }

    /* JSON – Paper Bank */
    if (ext === "json" && isPaperBank && papers) {
      const unimportedCount = papers.filter((p) => !isPaperAlreadyImported(p)).length;
      return (
        <div className="artifact-preview-modal__papers">
          <div className="artifact-preview-modal__papers-toolbar">
            <span>
              {t(locale, `共 ${papers.length} 篇文献`, `${papers.length} paper(s)`)}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="artifact-preview-modal__import-all-btn"
                onClick={() => void handleImportAll()}
                disabled={importingAll || unimportedCount === 0}
              >
                {importingAll
                  ? t(locale, "导入中…", "Importing…")
                  : unimportedCount === 0
                    ? t(locale, "✓ 全部已导入", "✓ All Imported")
                    : t(locale, `全部导入 (${unimportedCount})`, `Import All (${unimportedCount})`)}
              </button>
              <button
                type="button"
                className="artifact-preview-modal__goto-lib-btn"
                onClick={() => { onOpenLiterature(); onClose(); }}
              >
                {t(locale, "打开文献库 →", "Open Library →")}
              </button>
            </div>
          </div>
          <div className="artifact-preview-modal__paper-list">
            {papers.map((paper, idx) => {
              const imported = isPaperAlreadyImported(paper);
              const paperUrl = paper.url || paper.link || (paper.doi ? `https://doi.org/${paper.doi}` : "");
              return (
                <div key={paper.doi || paper.title || idx} className={`artifact-preview-modal__paper-card${imported ? " is-imported" : ""}`}>
                  <div className="artifact-preview-modal__paper-title">
                    {paper.title ?? t(locale, "无标题", "Untitled")}
                  </div>
                  <div className="artifact-preview-modal__paper-meta">
                    {paper.authors && paper.authors.length > 0 && (
                      <span>{paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " et al." : ""}</span>
                    )}
                    {paper.year ? <span>{paper.year}</span> : null}
                    {paper.journal ? <span>{paper.journal}</span> : null}
                  </div>
                  {paper.doi && (
                    <div className="artifact-preview-modal__paper-doi">
                      DOI:{" "}
                      <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer">
                        {paper.doi}
                      </a>
                    </div>
                  )}
                  {paperUrl && !paper.doi && (
                    <div className="artifact-preview-modal__paper-doi">
                      <a href={paperUrl} target="_blank" rel="noopener noreferrer">
                        {paperUrl}
                      </a>
                    </div>
                  )}
                  {paper.abstract && (
                    <div className="artifact-preview-modal__paper-abstract">
                      {paper.abstract.length > 200 ? `${paper.abstract.slice(0, 200)}…` : paper.abstract}
                    </div>
                  )}
                  <div className="artifact-preview-modal__paper-actions">
                    {imported ? (
                      <span className="artifact-preview-modal__imported-badge">
                        {t(locale, "✓ 已导入", "✓ Imported")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="artifact-preview-modal__import-btn"
                        onClick={() => void handleImportPaper(paper)}
                      >
                        {t(locale, "导入到文献库", "Import to Library")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    /* JSON – generic */
    if (ext === "json" && parsedJson) {
      return (
        <div className="artifact-preview-modal__json">
          <pre>{JSON.stringify(parsedJson, null, 2)}</pre>
        </div>
      );
    }

    /* Fallback: raw text */
    return (
      <div className="artifact-preview-modal__raw">
        <pre>{content}</pre>
      </div>
    );
  }

  return (
    <div className="artifact-preview-modal" onClick={onClose}>
      <div
        className="artifact-preview-modal__panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="artifact-preview-modal__header">
          <div className="artifact-preview-modal__header-info">
            <span className="artifact-preview-modal__file-icon">
              {ext === "md" ? "📝" : ext === "json" ? "📊" : "📄"}
            </span>
            <span className="artifact-preview-modal__file-name">{name}</span>
            <span className="artifact-preview-modal__file-badge">{ext.toUpperCase()}</span>
          </div>
          <button
            type="button"
            className="artifact-preview-modal__close-btn"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="artifact-preview-modal__body">
          {renderBody()}
        </div>
      </div>
    </div>
  );
}
