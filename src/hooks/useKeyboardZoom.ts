import { useEffect } from "react";

import type { PDFJSWrapper, PdfScaleValue } from "../lib/pdf-js-wrapper";

const ZOOM_STEP = 0.1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], .cm-editor, .cm-content"),
  );
}

export function useKeyboardZoom(
  pdfJsWrapper: PDFJSWrapper | null,
  onScaleChange: (scale: number) => void,
) {
  useEffect(() => {
    if (!pdfJsWrapper) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      if (!pdfJsWrapper.isVisible() || isEditableTarget(event.target)) {
        return;
      }

      let nextScale: number | null = null;
      let nextScaleValue: PdfScaleValue | null = null;

      if (event.key === "=" || event.key === "+" || event.key === "Add") {
        nextScale = Math.min(MAX_SCALE, Math.round((pdfJsWrapper.currentScale + ZOOM_STEP) * 100) / 100);
      } else if (event.key === "-" || event.key === "_" || event.key === "Subtract") {
        nextScale = Math.max(MIN_SCALE, Math.round((pdfJsWrapper.currentScale - ZOOM_STEP) * 100) / 100);
      } else if (event.key === "0") {
        nextScaleValue = "page-width";
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (nextScaleValue) {
        pdfJsWrapper.setScale(nextScaleValue);
        onScaleChange(pdfJsWrapper.currentScale);
        return;
      }

      if (nextScale !== null) {
        pdfJsWrapper.setScale(nextScale);
        onScaleChange(nextScale);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onScaleChange, pdfJsWrapper]);
}
