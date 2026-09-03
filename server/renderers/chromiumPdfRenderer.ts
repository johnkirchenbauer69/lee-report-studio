import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

export interface ServerReportRenderer<T> {
  render(input: T): Promise<Uint8Array>;
}

export class ChromiumPdfRenderer implements ServerReportRenderer<{
  url: string;
  title: string;
}> {
  async render({
    url,
    title,
  }: {
    url: string;
    title: string;
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
      const narrativeOverflows = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-narrative-id]"),
        )
          .filter((element) => {
            const content =
              element.querySelector<HTMLElement>(".text-content");
            return Boolean(
              content && content.scrollHeight > content.clientHeight + 1,
            );
          })
          .map((element) => element.dataset.narrativeId ?? "unknown"),
      );
      if (narrativeOverflows.length)
        throw new Error(
          `Narrative overflow blocks publication: ${[...new Set(narrativeOverflows)].join(", ")}.`,
        );
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
