import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import {
  fitNarrativeFontSize,
  NARRATIVE_REFIT_EVENT,
  type NarrativeFitResult,
} from "../report-engine/layout/narrativeFontFit";

export type NarrativeFitListener = (
  marketId: string,
  result: NarrativeFitResult,
) => void;

/**
 * Measures a bound narrative's rendered text against its actual text box and
 * applies the largest font size between the authored size and +2 pt that
 * fits (see fitNarrativeFontSize). Runs in the editor preview and in the
 * Chromium print page alike, so both resolve the same size.
 *
 * Progress is exposed on the text node for the PDF renderer:
 *   data-narrative-fit="pending" | "done"
 *   data-narrative-font-size     chosen size in px
 *   data-narrative-overflow      "true" when it does not fit at the minimum
 * The fit re-runs when fonts finish loading and on NARRATIVE_REFIT_EVENT.
 */
export function useNarrativeFontFit(
  textRef: RefObject<HTMLElement | null>,
  options: {
    enabled: boolean;
    marketId?: string;
    onFit?: NarrativeFitListener;
  },
  deps: DependencyList,
) {
  const onFitRef = useRef(options.onFit);
  onFitRef.current = options.onFit;
  const lastReported = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!options.enabled || !text) return;
    const container = text.parentElement;
    if (!container) return;
    let disposed = false;

    const run = () => {
      if (disposed || !text.isConnected) return;
      // Measure from the authored size every time; never compound.
      text.style.fontSize = "";
      const basePx = Number.parseFloat(getComputedStyle(text).fontSize);
      if (!(container.clientHeight > 0) || !Number.isFinite(basePx) || basePx <= 0) {
        // No layout (e.g. a detached or zero-size box): keep the authored size.
        text.dataset.narrativeFit = "done";
        return;
      }
      // A flex item stretched to the box would hide its true content height;
      // measure it top-aligned at its natural height, then restore.
      const previousAlign = text.style.alignSelf;
      text.style.alignSelf = "flex-start";
      const result = fitNarrativeFontSize(basePx, (fontSizePx) => {
        text.style.fontSize = `${fontSizePx}px`;
        return {
          contentHeight: text.offsetHeight,
          availableHeight: container.clientHeight,
          contentWidth: text.scrollWidth,
          availableWidth: container.clientWidth,
        };
      });
      text.style.alignSelf = previousAlign;
      text.style.fontSize = result.increasePt > 0 ? `${result.fontSizePx}px` : "";
      text.dataset.narrativeFontSize = String(result.fontSizePx);
      text.dataset.narrativeOverflow = result.overflow ? "true" : "false";
      text.dataset.narrativeFit = "done";
      const signature = `${result.fontSizePx}:${result.overflow}`;
      if (options.marketId && signature !== lastReported.current) {
        lastReported.current = signature;
        onFitRef.current?.(options.marketId, result);
      }
    };

    text.dataset.narrativeFit = "pending";
    run();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const onFontsLoaded = () => run();
    fonts?.addEventListener?.("loadingdone", onFontsLoaded);
    void fonts?.ready?.then(run);
    window.addEventListener(NARRATIVE_REFIT_EVENT, run);
    return () => {
      disposed = true;
      fonts?.removeEventListener?.("loadingdone", onFontsLoaded);
      window.removeEventListener(NARRATIVE_REFIT_EVENT, run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled, options.marketId, ...deps]);
}
