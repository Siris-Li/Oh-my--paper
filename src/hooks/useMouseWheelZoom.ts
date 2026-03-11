import { useCallback, useEffect, useRef } from "react";

import type { PDFJSWrapper } from "../lib/pdf-js-wrapper";

const MAX_SCALE_FACTOR = 1.2;
const SCALE_FACTOR_DIVISOR = 20;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

export function useMouseWheelZoom(
  pdfJsWrapper: PDFJSWrapper | null,
  onScaleChange: (scale: number) => void,
) {
  const isZoomingRef = useRef(false);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);
  const zoomTimeoutRef = useRef<number | null>(null);

  const performZoom = useCallback(
    (event: WheelEvent, wrapper: PDFJSWrapper) => {
      const scrollMagnitude = Math.abs(event.deltaY);
      const scaleFactorMagnitude = Math.min(
        1 + scrollMagnitude / SCALE_FACTOR_DIVISOR,
        MAX_SCALE_FACTOR,
      );
      const previousScale = wrapper.currentScale;
      if (!Number.isFinite(previousScale) || previousScale <= 0) {
        return;
      }

      const scaleFactor = event.deltaY < 0 ? scaleFactorMagnitude : 1 / scaleFactorMagnitude;
      const nextScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, Math.round(previousScale * scaleFactor * 100) / 100),
      );
      const exactFactor = nextScale / previousScale;
      if (!Number.isFinite(exactFactor) || exactFactor <= 0 || exactFactor === 1) {
        return;
      }

      const scrollElement =
        wrapper.container.querySelector<HTMLElement>(".pdfjs-viewer-inner") ?? wrapper.container;
      const scrollLeft = scrollElement.scrollLeft;
      const scrollTop = scrollElement.scrollTop;
      const bounds = scrollElement.getBoundingClientRect();
      const mouseX = event.clientX - bounds.left;
      const mouseY = event.clientY - bounds.top;

      wrapper.setScale(nextScale);
      onScaleChange(nextScale);

      window.requestAnimationFrame(() => {
        scrollElement.scrollLeft = scrollLeft + mouseX * exactFactor - mouseX;
        scrollElement.scrollTop = scrollTop + mouseY * exactFactor - mouseY;
      });
    },
    [onScaleChange],
  );

  useEffect(() => {
    if (!pdfJsWrapper) {
      return;
    }

    const container = pdfJsWrapper.container;

    const handleWheel = (event: WheelEvent) => {
      if ((event.metaKey || event.ctrlKey) && !isScrollingRef.current) {
        event.preventDefault();

        if (!isZoomingRef.current) {
          isZoomingRef.current = true;
          performZoom(event, pdfJsWrapper);
          if (zoomTimeoutRef.current) {
            window.clearTimeout(zoomTimeoutRef.current);
          }
          zoomTimeoutRef.current = window.setTimeout(() => {
            isZoomingRef.current = false;
          }, 5);
        }
        return;
      }

      isScrollingRef.current = true;
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        isScrollingRef.current = false;
      }, 100);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      if (zoomTimeoutRef.current) {
        window.clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, [pdfJsWrapper, performZoom]);
}
