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
  offline?: boolean;
}> {
  async render({
    url,
    title,
    onLayout,
    offline,
  }: {
    url: string;
    title: string;
    onLayout?: (layout: ChromiumRenderLayout) => void;
    offline?: boolean;
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
      if (offline) await page.route("**/*", route => {
        const requested = new URL(route.request().url());
        return requested.origin === new URL(url).origin || ["data:", "blob:"].includes(requested.protocol) ? route.continue() : route.abort();
      });
      await page.emulateMedia({ media: "screen" });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForSelector('[data-render-ready="true"]', {
        timeout: 120_000,
      });
      await page.waitForFunction(() => document.fonts.status === "loaded" &&
        Array.from(document.images).every(image => image.complete), undefined, { timeout: 120_000 });
      const brokenImages = await page.evaluate(() => Array.from(document.images)
        .filter(image => image.naturalWidth === 0).map(image => image.alt || "Unnamed image"));
      if (brokenImages.length) throw new Error(`PDF assets failed to load: ${brokenImages.join(", ")}`);
      const unavailableFonts = await page.evaluate(() => {
        const used = new Set(Array.from(document.querySelectorAll(".text-content, th, td, svg text"))
          .map(node => getComputedStyle(node).fontFamily.match(/["']?(LEE Managed [^,"']+)/)?.[1]).filter(Boolean));
        const faces = Array.from(document.fonts);
        return Array.from(used).filter(family => !faces.some(face => face.family.replace(/^["']|["']$/g, "") === family && face.status === "loaded"));
      });
      if (unavailableFonts.length) throw new Error(`PDF managed fonts failed to load: ${unavailableFonts.join(", ")}`);
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
      const geographicOverflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(
        '[data-testid^="activity-"] .text-content, [data-testid^="featured-"] .text-content'))
        .filter(node => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
        .map(node => node.closest("[data-testid]")?.getAttribute("data-testid") ?? "Geographic text"));
      if (geographicOverflow.length) throw new Error(`Geographic text exceeds its frame: ${geographicOverflow.join(", ")}`);
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
