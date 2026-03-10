import { pdfjs, Document, Page } from "react-pdf";
import { useMemo, useState } from "react";

import type { CompileResult } from "../types";

import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface PdfPaneProps {
  compileResult: CompileResult;
  highlightedPage: number;
  onPageJump: (page: number) => void;
}

export function PdfPane({ compileResult, highlightedPage, onPageJump }: PdfPaneProps) {
  const [pageCount, setPageCount] = useState(0);
  const file = useMemo(() => {
    if (!compileResult.pdfData) {
      return undefined;
    }
    return { data: compileResult.pdfData };
  }, [compileResult.pdfData]);

  return (
    <>
      <div className="preview-header">
        <span style={{ fontWeight: 500 }}>PDF 预览</span>
        <div style={{ display: "flex", gap: "12px", color: "var(--text-secondary)" }}>
          <span>{compileResult.status === "success" ? "编译成功" : compileResult.status === "failed" ? "编译失败" : compileResult.status}</span>
          <span>{pageCount ? `共 ${pageCount} 页` : "暂无页面"}</span>
        </div>
      </div>

      {pageCount > 0 && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-light)", display: "flex", gap: "6px", overflowX: "auto", background: "var(--bg-sidebar)" }}>
          {Array.from({ length: Math.max(pageCount, 1) }, (_, index) => (
            <button
              key={`jump-${index + 1}`}
              className={highlightedPage === index + 1 ? "btn-primary" : "btn-secondary"}
              style={{ padding: "4px 10px", borderRadius: "4px", fontSize: "11px", minWidth: "32px" }}
              onClick={() => onPageJump(index + 1)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}

      <div className="preview-content">
        {file ? (
          <Document
            file={file}
            onLoadSuccess={({ numPages }) => setPageCount(numPages)}
            loading={<div className="pdf-placeholder">正在加载 PDF 文件...</div>}
            error={<div className="pdf-placeholder">无法加载预览文档</div>}
          >
            {Array.from({ length: pageCount || 1 }, (_, index) => {
              const page = index + 1;
              return (
                <div key={page} className={`pdf-page-frame ${highlightedPage === page ? "is-highlighted" : ""}`}>
                  <button className="pdf-page-hitbox" onClick={() => onPageJump(page)} type="button">
                    <Page pageNumber={page} width={430} renderTextLayer={false} renderAnnotationLayer={false} />
                  </button>
                </div>
              );
            })}
          </Document>
        ) : (
          <div className="pdf-placeholder">编译项目以查看 PDF 预览</div>
        )}
      </div>
    </>
  );
}
