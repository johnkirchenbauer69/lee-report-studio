import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

export interface ServerReportRenderer<T> {
  render(input: T): Promise<Uint8Array>;
}

/** Must match NARRATIVE_REFIT_EVENT in src/report-engine/layout/narrativeFontFit.ts. */
export const NARRATIVE_REFIT_EVENT = "lee:refit-narratives";

export interface ChromiumRenderLayout {
  /** Narrative ids whose text does not fit at the authored minimum size. */
  narrativeOverflow: string[];
}

export class ChromiumPdfRenderer implements ServerReportRenderer<{
  url: string;
  title: string;
  onLayout?: (layout: ChromiumRenderLayout) => void;
}> {
  async render({
    url,
    title,
    onLayout,
  }: {
    url: string;
    title: string;
    onLayout?: (layout: ChromiumRenderLayout) => void;
  }): Promise<Uint8Array> {
    const browser = await chromium.launch({
      headless: true,
      args: ["--font-render-hinting=none"],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 816, height: 1056 },
        deviceScaleFactor: 1,
        colorScheme: "light",
      });
      await page.emulateMedia({ media: "screen" });
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-render-ready="true"]', {
        timeout: 30_000,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images).map((image) =>
            image.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  image.addEventListener("load", () => resolve(), {
                    once: true,
                  });
                  image.addEventListener("error", () => resolve(), {
                    once: true,
                  });
                }),
          ),
        );
      });
      // Dynamic narrative font sizing: re-measure every narrative now that
      // managed fonts are loaded, then wait until none is still pending, so
      // the PDF captures the same fitted size the preview computes.
      await page.evaluate(
        (eventName) => window.dispatchEvent(new Event(eventName)),
        NARRATIVE_REFIT_EVENT,
      );
      await page
        .waitForFunction(
          () => !document.querySelector('[data-narrative-fit="pending"]'),
          undefined,
          { timeout: 10_000 },
        )
        .catch(() => undefined);
      const narrativeOverflow = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('[data-narrative-overflow="true"]'),
        ).map(
          (node) =>
            node.closest("[data-narrative-id]")?.getAttribute("data-narrative-id") ??
            "unknown",
        ),
      );
      onLayout?.({ narrativeOverflow });
      // Fixed publication page bounds: never silently clip editorial additions.
      const closingProblems = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".closing-content")).flatMap(node => {
          const errors: string[] = [];
          if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
            errors.push("Closing page content exceeds its page bounds. Shorten it or split it into an additional template page.");
          for (const image of node.querySelectorAll<HTMLImageElement>("img"))
            if (!image.complete || image.naturalWidth === 0) errors.push(`Closing page asset unavailable: ${image.alt}`);
          const copy = node.querySelector<HTMLElement>(".closing-company-copy");
          const growth = node.querySelector<HTMLElement>(".closing-growth");
          if (copy && growth && copy.getBoundingClientRect().bottom > growth.getBoundingClientRect().top)
            errors.push("Company narrative overlaps the growth timeline. Shorten the narrative or add a page.");
          const lastStatistic = node.querySelector<HTMLElement>(".closing-statistics > div:last-child");
          if (lastStatistic && growth && lastStatistic.getBoundingClientRect().bottom > growth.getBoundingClientRect().top)
            errors.push("Corporate statistics overlap the growth timeline. Shorten them or add a page.");
          return errors;
        }),
      );
      if (closingProblems.length) throw new Error(closingProblems.join("\n"));
      const chromiumBytes = await page.pdf({
        format: "Letter",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        displayHeaderFooter: false,
      });
      const pdf = await PDFDocument.load(chromiumBytes);
      pdf.setTitle(title);
      pdf.setCreator("LEE Report Studio");
      pdf.setProducer("LEE Report Studio Chromium renderer");
      pdf.setCreationDate(new Date(0));
      pdf.setModificationDate(new Date(0));
      return pdf.save({ useObjectStreams: false, addDefaultPage: false });
    } finally {
      await browser.close();
    }
  }
}
