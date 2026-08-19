import type { ReportTemplate } from "../../types/report";
import type { ReportRenderer } from "../ReportRenderer";

export class ChromiumPdfClient implements ReportRenderer<
  { template: ReportTemplate; data: unknown; title: string },
  Blob
> {
  async render(
    input: { template: ReportTemplate; data: unknown; title: string },
    options?: { signal?: AbortSignal },
  ) {
    const response = await fetch("/api/render/pdf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: options?.signal,
    });
    if (!response.ok)
      throw new Error(
        (
          (await response
            .json()
            .catch(() => ({ error: "PDF render failed" }))) as {
            error?: string;
          }
        ).error ?? "PDF render failed",
      );
    return response.blob();
  }
}

export async function exportChromiumPdf(
  template: ReportTemplate,
  data: unknown,
  fileName: string,
) {
  const blob = await new ChromiumPdfClient().render({
    template,
    data,
    title: template.name,
  });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
