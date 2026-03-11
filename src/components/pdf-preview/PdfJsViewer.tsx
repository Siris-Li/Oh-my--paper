import { memo, useCallback, useEffect, useRef, useState } from "react";

import { useKeyboardZoom } from "../../hooks/useKeyboardZoom";
import { useMouseWheelZoom } from "../../hooks/useMouseWheelZoom";
import { renderSyncHighlights } from "../../lib/pdf-highlights";
import { PDFJSWrapper, type PdfScaleValue } from "../../lib/pdf-js-wrapper";
import { resolvePdfSource } from "../../lib/pdf-source";
import type { SyncHighlight } from "../../types";

type PdfSource = Uint8Array | string | undefined;

export interface PdfJsViewerProps {
  source: PdfSource;
  reloadKey?: string;
  isLoading?: boolean;
  onDebug?: (level: "info" | "warn" | "error", message: string, details?: unknown) => void;
  highlightedPage: number;
  highlights?: SyncHighlight[];
  onPageJump: (page: number) => void;
  onDoubleClickPage?: (page: number, h: number, v: number) => void;
  statusLabel: string;
}

function PdfJsViewerInner({
  source,
  reloadKey,
  isLoading,
  onDebug,
  highlightedPage,
  highlights,
  onPageJump,
  onDoubleClickPage,
  statusLabel,
}: PdfJsViewerProps) {
  const [pdfJsWrapper, setPdfJsWrapper] = useState<PDFJSWrapper | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [errorMessage, setErrorMessage] = useState("");
  const SCALE_STORAGE_KEY = "viwerleaf.pdf.scale";
  const onDebugRef = useRef<PdfJsViewerProps["onDebug"]>(onDebug);
  const lastLoadSignatureRef = useRef("");
  const lastWrapperRef = useRef<PDFJSWrapper | null>(null);
  const scalePreferenceRef = useRef<PdfScaleValue>(
    (() => {
      const saved = localStorage.getItem(SCALE_STORAGE_KEY);
      if (saved !== null) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
      return "page-width";
    })(),
  );
  const highlightRendererRef = useRef<{ clear: () => void } | null>(null);
  useEffect(() => {
    onDebugRef.current = onDebug;
  }, [onDebug]);
  const debug = useCallback(
    (level: "info" | "warn" | "error", message: string, details?: unknown) => {
      const reporter = onDebugRef.current;
      reporter?.(level, `[pdf-viewer] ${message}`, details);
      if (!reporter) {
        if (level === "error") {
          console.error(`[pdf-viewer] ${message}`, details);
        } else if (level === "warn") {
          console.warn(`[pdf-viewer] ${message}`, details);
        } else {
          console.info(`[pdf-viewer] ${message}`, details);
        }
      }
    },
    [],
  );

  const handleContainer = useCallback((parent: HTMLDivElement | null) => {
    if (!parent) {
      return;
    }

    const inner = parent.firstElementChild;
    if (!(inner instanceof HTMLDivElement)) {
      return;
    }

    setPdfJsWrapper((prev) => {
      if (prev) {
        void prev.destroy();
      }
      return new PDFJSWrapper(inner);
    });
  }, []);

  useEffect(() => {
    return () => {
      highlightRendererRef.current?.clear();
      highlightRendererRef.current = null;
      if (pdfJsWrapper) {
        void pdfJsWrapper.destroy();
      }
    };
  }, [pdfJsWrapper]);

  useEffect(() => {
    if (!pdfJsWrapper) {
      return;
    }

    const stopPageChange = pdfJsWrapper.onPageChange((page) => {
      setCurrentPage(page);
      setPageInput(String(page));
    });
    const stopScaleChange = pdfJsWrapper.onScaleChange((nextScale) => {
      setScale(nextScale);
    });

    return () => {
      stopPageChange();
      stopScaleChange();
    };
  }, [pdfJsWrapper]);

  useEffect(() => {
    if (!pdfJsWrapper) {
      return;
    }

    if (lastWrapperRef.current !== pdfJsWrapper) {
      lastWrapperRef.current = pdfJsWrapper;
      lastLoadSignatureRef.current = "";
    }

    const signature = source
      ? source instanceof Uint8Array
        ? `bytes:${reloadKey ?? ""}:${source.byteLength}`
        : `url:${reloadKey ?? ""}:${source}`
      : `empty:${reloadKey ?? ""}`;

    if (signature === lastLoadSignatureRef.current) {
      return;
    }
    lastLoadSignatureRef.current = signature;

    if (!source) {
      if (isLoading) {
        debug("info", "source is empty while loading, keep current document", {
          reloadKey,
          isLoading: true,
        });
        return;
      }
      debug("warn", "source is empty, clearing document", {
        reloadKey,
        isLoading: Boolean(isLoading),
      });
      setPageCount(0);
      setCurrentPage(1);
      setPageInput("1");
      setErrorMessage("");
      void pdfJsWrapper.clearDocument();
      return;
    }

    setErrorMessage("");
    debug("info", "begin loadDocument", {
      reloadKey,
      sourceType: source instanceof Uint8Array ? "bytes" : "url",
      sourceSize: source instanceof Uint8Array ? source.length : undefined,
      isLoading: Boolean(isLoading),
    });

    void pdfJsWrapper
      .loadDocument(source)
      .then((document) => {
        if (!document) {
          debug("info", "loadDocument resolved but ignored", {
            reloadKey,
            hasDocument: Boolean(document),
          });
          return;
        }

        pdfJsWrapper.setScale(scalePreferenceRef.current);
        setPageCount(document.numPages);
        setCurrentPage(pdfJsWrapper.currentPage);
        setPageInput(String(pdfJsWrapper.currentPage));
        setScale(pdfJsWrapper.currentScale);
        debug("info", "loadDocument success", {
          reloadKey,
          pages: document.numPages,
          currentPage: pdfJsWrapper.currentPage,
          currentScale: pdfJsWrapper.currentScale,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message || "加载 PDF 失败");
        setPageCount(0);
        debug("error", "loadDocument failed", {
          reloadKey,
          reason: message || "加载 PDF 失败",
        });
      });
  }, [debug, isLoading, pdfJsWrapper, reloadKey, source]);

  useEffect(() => {
    if (!pdfJsWrapper || !pageCount || highlightedPage <= 0) {
      return;
    }

    if (highlightedPage !== pdfJsWrapper.currentPage) {
      pdfJsWrapper.scrollToPage(highlightedPage);
      setCurrentPage(pdfJsWrapper.currentPage);
      setPageInput(String(pdfJsWrapper.currentPage));
    }
  }, [highlightedPage, pageCount, pdfJsWrapper]);

  useEffect(() => {
    highlightRendererRef.current?.clear();
    highlightRendererRef.current = null;

    if (!pdfJsWrapper || !pageCount || !highlights?.length) {
      return;
    }

    const targetPage = highlights[0]?.page ?? 0;
    if (targetPage > 0 && targetPage !== pdfJsWrapper.currentPage) {
      pdfJsWrapper.scrollToPage(targetPage);
    }

    const timer = window.setTimeout(() => {
      highlightRendererRef.current = renderSyncHighlights(
        pdfJsWrapper.viewerElement,
        highlights,
        (page) => pdfJsWrapper.getPageViewport(page),
      );
    }, 150);

    return () => {
      window.clearTimeout(timer);
      highlightRendererRef.current?.clear();
      highlightRendererRef.current = null;
    };
  }, [highlights, pageCount, pdfJsWrapper]);

  useEffect(() => {
    if (!pdfJsWrapper || !onDoubleClickPage) {
      return;
    }

    const container = pdfJsWrapper.container;
    const handleDoubleClick = (event: MouseEvent) => {
      const pageElement = (event.target instanceof Element ? event.target : null)?.closest(
        ".page[data-page-number]",
      );
      if (!(pageElement instanceof HTMLElement)) {
        return;
      }

      const pageNumber = Number.parseInt(pageElement.dataset.pageNumber ?? "0", 10);
      if (!pageNumber) {
        return;
      }

      const canvas = pageElement.querySelector("canvas");
      const pageSize = pdfJsWrapper.getPageViewport(pageNumber);
      if (!(canvas instanceof HTMLCanvasElement) || !pageSize || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) {
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(event.clientX - bounds.left, bounds.width));
      const relativeY = Math.max(0, Math.min(event.clientY - bounds.top, bounds.height));
      const scaleX = pageSize.width / canvas.clientWidth;
      const scaleY = pageSize.height / canvas.clientHeight;

      onDoubleClickPage(
        pageNumber,
        relativeX * scaleX,
        pageSize.height - relativeY * scaleY,
      );
    };

    container.addEventListener("dblclick", handleDoubleClick);
    return () => container.removeEventListener("dblclick", handleDoubleClick);
  }, [onDoubleClickPage, pdfJsWrapper]);

  useEffect(() => {
    if (!pdfJsWrapper || !("ResizeObserver" in window)) {
      return;
    }

    let timeoutId = 0;
    const resizeListener = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        pdfJsWrapper.updateOnResize();
      }, 120);
    };

    const resizeObserver = new ResizeObserver(resizeListener);
    resizeObserver.observe(pdfJsWrapper.container);
    window.addEventListener("resize", resizeListener);

    return () => {
      window.clearTimeout(timeoutId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeListener);
    };
  }, [pdfJsWrapper]);

  const jumpToPage = useCallback(
    (page: number) => {
      if (!pdfJsWrapper || !pageCount) {
        return;
      }

      const target = Math.max(1, Math.min(page, pageCount));
      pdfJsWrapper.scrollToPage(target);
      setCurrentPage(pdfJsWrapper.currentPage);
      setPageInput(String(pdfJsWrapper.currentPage));
      onPageJump(target);
    },
    [onPageJump, pageCount, pdfJsWrapper],
  );

  const applyScale = useCallback(
    (next: PdfScaleValue) => {
      if (!pdfJsWrapper) {
        return;
      }

      scalePreferenceRef.current = next;
      if (typeof next === "number") {
        localStorage.setItem(SCALE_STORAGE_KEY, String(next));
      } else {
        localStorage.removeItem(SCALE_STORAGE_KEY);
      }
      pdfJsWrapper.setScale(next);
      setScale(pdfJsWrapper.currentScale);
    },
    [pdfJsWrapper],
  );

  const handleZoomScaleChange = useCallback((nextScale: number) => {
    setScale(nextScale);
    scalePreferenceRef.current = nextScale;
    localStorage.setItem(SCALE_STORAGE_KEY, String(nextScale));
  }, []);

  useMouseWheelZoom(pdfJsWrapper, handleZoomScaleChange);
  useKeyboardZoom(pdfJsWrapper, handleZoomScaleChange);

  const handlePageInputCommit = useCallback(() => {
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage));
      return;
    }
    jumpToPage(parsed);
  }, [currentPage, jumpToPage, pageInput]);

  const noDocument = !source && !errorMessage;

  return (
    <>
      <div className="preview-header">
        <span style={{ fontWeight: 500 }}>PDF 预览</span>
        <div style={{ display: "flex", gap: "12px", color: "var(--text-secondary)" }}>
          <span>{statusLabel}</span>
          <span>{pageCount ? `共 ${pageCount} 页` : "暂无页面"}</span>
        </div>
      </div>

      <div className="preview-content preview-content-pdf">
        <div className="pdf-toolbar">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => jumpToPage(currentPage - 1)}
            disabled={pageCount <= 0 || currentPage <= 1}
          >
            上一页
          </button>
          <input
            value={pageInput}
            className="pdf-page-input"
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={handlePageInputCommit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handlePageInputCommit();
              }
            }}
            aria-label="页码"
          />
          <span className="text-subtle">/ {Math.max(pageCount, 1)}</span>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => jumpToPage(currentPage + 1)}
            disabled={pageCount <= 0 || currentPage >= pageCount}
          >
            下一页
          </button>

          <div style={{ width: 1, height: 20, background: "var(--border-light)", margin: "0 4px" }} />

          <button className="btn-secondary" type="button" onClick={() => applyScale(Math.max(0.25, scale - 0.1))}>
            -
          </button>
          <span className="text-subtle" style={{ minWidth: 56, textAlign: "center" }}>
            {Math.round(scale * 100)}%
          </span>
          <button className="btn-secondary" type="button" onClick={() => applyScale(Math.min(5, scale + 0.1))}>
            +
          </button>
          <button className="btn-secondary" type="button" onClick={() => applyScale("page-width")}>
            适应宽度
          </button>
          <button className="btn-secondary" type="button" onClick={() => applyScale("page-fit")}>
            适应页面
          </button>
        </div>

        {errorMessage ? (
          <div className="pdf-placeholder">PDF 加载失败：{errorMessage}</div>
        ) : noDocument ? (
          <div className="pdf-placeholder">{isLoading ? "正在加载 PDF 文件..." : "暂无可预览的 PDF"}</div>
        ) : (
          <div className="pdfjs-viewer pdfjs-viewer-outer" ref={handleContainer}>
            <div className="pdfjs-viewer-inner" tabIndex={0} role="tabpanel">
              <div className="pdfViewer" />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function arePdfJsViewerPropsEqual(previous: PdfJsViewerProps, next: PdfJsViewerProps) {
  return (
    previous.source === next.source &&
    previous.reloadKey === next.reloadKey &&
    previous.isLoading === next.isLoading &&
    previous.onDebug === next.onDebug &&
    previous.highlightedPage === next.highlightedPage &&
    previous.highlights === next.highlights &&
    previous.onPageJump === next.onPageJump &&
    previous.onDoubleClickPage === next.onDoubleClickPage &&
    previous.statusLabel === next.statusLabel
  );
}

const PdfJsViewer = memo(PdfJsViewerInner, arePdfJsViewerPropsEqual);

export function toPdfSource(fileData?: Uint8Array, fileUrl?: string, allowUrlFallback = true): PdfSource {
  return resolvePdfSource(fileData, fileUrl, allowUrlFallback);
}

export default PdfJsViewer;
