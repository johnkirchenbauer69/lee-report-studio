import { chromium, type BrowserServer } from "playwright";
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
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (stage: string, detail?: unknown) => void;
}> {
  async render({
    url,
    title,
    onLayout,
    offline,
    signal,
    timeoutMs = 180_000,
    onProgress,
  }: {
    url: string;
    title: string;
    onLayout?: (layout: ChromiumRenderLayout) => void;
    offline?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (stage: string, detail?: unknown) => void;
  }): Promise<Uint8Array> {
    let stage = "launch";
    const progress = (next: string, detail?: unknown) => { stage = next; onProgress?.(next, detail); };
    let server: BrowserServer | undefined;
    const pendingRequests = new Set<string>();
    const heartbeat = setInterval(() => onProgress?.(stage, { heartbeat: true, pendingAssets: [...pendingRequests], memoryMB: Math.round(process.memoryUsage().rss / 1048576), cpu: process.cpuUsage() }), 10_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`PDF deadline exceeded after ${timeoutMs}ms during ${stage}`)), timeoutMs);
      abort = () => reject(new Error(`PDF cancelled during ${stage}: ${signal?.reason ?? "cancelled"}`));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    // Observe cancellation during launch; the same rejection is awaited below.
    void deadline.catch(() => undefined);
    try {
      signal?.throwIfAborted();
      progress("launch");
      // Launch has its own bounded timeout; retaining the server owns this browser only.
      server = await chromium.launchServer({ headless: true, timeout: Math.min(timeoutMs, 30_000), args: ["--font-render-hinting=none"] });
      return await Promise.race([deadline, (async () => {
      const browser = await chromium.connect(server!.wsEndpoint());
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
      page.on("request", request => pendingRequests.add(request.url().split("?")[0]));
      page.on("requestfinished", request => pendingRequests.delete(request.url().split("?")[0]));
      page.on("requestfailed", request => pendingRequests.delete(request.url().split("?")[0]));
      page.on("requestfailed", request => progress(stage, { failedRequest: request.url().split("?")[0], error: request.failure() }));
      page.on("pageerror", error => progress(stage, { pageError: error.message }));
      progress("navigation");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      progress("report-ready");
      await page.waitForFunction(() => Boolean(document.querySelector('[data-render-ready="true"], .print-error')), undefined, { timeout: 120_000 });
      const printError = await page.evaluate(() => document.querySelector(".print-error")?.textContent ?? null);
      if (printError) throw new Error(`Print readiness failed: ${printError}`);
      progress("page-inventory", await page.evaluate(() => Array.from(document.querySelectorAll("section.print-page")).map((node, index) => ({ page: index + 1, anchor: node.getAttribute("data-page-anchor"), images: Array.from(node.querySelectorAll("img")).map(image => ({ alt: image.alt, source: image.src.split("?")[0], complete: image.complete, width: image.naturalWidth })) }))));
      progress("fonts-and-images");
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
      progress("narrative-refit");
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
        );
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
      progress("layout-validation");
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
      progress("pdf-print");
      const chromiumBytes = await page.pdf({
        format: "Letter",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        displayHeaderFooter: false,
      });
      progress("pdf-metadata");
      const pdf = await PDFDocument.load(chromiumBytes);
      pdf.setTitle(title);
      pdf.setCreator("LEE Report Studio");
      pdf.setProducer("LEE Report Studio Chromium renderer");
      pdf.setCreationDate(new Date(0));
      pdf.setModificationDate(new Date(0));
      const result = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
      progress("pdf-complete", { bytes: result.length });
      return result;
      })()]);
    } finally {
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      progress("browser-cleanup");
      if (server) {
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([server.close(), new Promise<never>((_resolve, reject) => {
            cleanupTimer = setTimeout(() => reject(new Error("Browser close timeout")), 5_000);
          })]);
        } catch {
          // Playwright kills only the process tree belonging to this launch.
          await server.kill();
        } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
      }
      progress("browser-closed");
    }
  }
}
