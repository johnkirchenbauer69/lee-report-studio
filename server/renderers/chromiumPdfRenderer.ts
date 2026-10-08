import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

export interface ServerReportRenderer<T> {
  render(input: T): Promise<Uint8Array>;
}

export class ChromiumPdfRenderer implements ServerReportRenderer<{
  url: string;
  title: string;
  offline?: boolean;
}> {
  async render({
    url,
    title,
    offline,
  }: {
    url: string;
    title: string;
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
