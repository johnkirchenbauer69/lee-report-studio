import type { ManualOverride } from "../../report-engine/schema/generation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CanvasElement } from "../../components/CanvasElement";
import type { EditorSettings, ReportTemplate } from "../../types/report";
import { sampleTemplate } from "../../data/sampleTemplate";
import { sampleData } from "../../data/sampleData";
import { installManagedFonts } from "../../services/fontRegistry";

const settings: EditorSettings = {
  unit: "px",
  gridEnabled: false,
  gridSpacingPx: 24,
  gridOpacity: 0,
  snapToGrid: false,
  snapToElements: false,
  snapToMargins: false,
  marginPx: 0,
  marginsEnabled: false,
  rulersEnabled: false,
  customGuides: [],
};
const noop = () => undefined;
interface Job {
  template: ReportTemplate;
  data: unknown;
  title: string;
  manualOverrides?: ManualOverride[];
}

export function PrintReport({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/render-jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Render job unavailable")),
      )
      .then((value) => { if (!controller.signal.aborted) setJob(value); })
      .catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [jobId]);
  if (error) return <main className="print-error">{error}</main>;
  if (!job) return <main className="print-loading">Preparing report…</main>;
  return <PrintPages template={job.template} data={job.data} manualOverrides={job.manualOverrides} />;
}

export function BenchmarkPrintReport() {
  return <PrintPages template={sampleTemplate} data={sampleData} />;
}

export function PrintPages({
  template,
  data,
  manualOverrides,
}: {
  template: ReportTemplate;
  data: unknown;
  manualOverrides?: ManualOverride[];
}) {
  const [fontsReady, setFontsReady] = useState(false);
  const [fontError, setFontError] = useState<string>();
  const [nativePage, setNativePage] = useState<number | undefined>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("nativeCapture") === "1" ? 0 : undefined,
  );
  const documentRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!fontsReady || template.id !== "industrial-market-geographic") return;
    const frames = documentRef.current?.querySelectorAll<HTMLElement>(
      '[data-testid$="featured-area"] .text-content, [data-testid*="activity-"][data-testid$="-address"] .text-content',
    );
    for (const frame of frames ?? []) {
      frame.style.fontSize = "";
      const original = parseFloat(getComputedStyle(frame).fontSize);
      // These slots hold one line. Fit the actual frozen text using the loaded
      // publication font, including on previously saved report revisions.
      frame.style.whiteSpace = "nowrap";
      const overflows = () => frame.scrollWidth > frame.clientWidth + 1 ||
        frame.scrollHeight > frame.clientHeight + 1;
      for (let size = original - 0.25; size >= 9.25 && overflows(); size -= 0.25) {
        frame.style.fontSize = `${size}px`;
      }
      frame.dataset.geographicTextOverflow = String(overflows());
    }
  }, [fontsReady, template, data, manualOverrides, nativePage]);
  const visiblePages = template.pages.filter((page) => !page.hidden);
  useEffect(() => {
    if (nativePage === undefined) return;
    const selectPage = (event: Event) => {
      const index = (event as CustomEvent).detail;
      if (Number.isInteger(index) && index >= 0 && index < visiblePages.length) setNativePage(index);
    };
    window.addEventListener("lee:native-page", selectPage);
    return () => window.removeEventListener("lee:native-page", selectPage);
  }, [nativePage === undefined, visiblePages.length]);
  useEffect(() => {
    setFontsReady(false);
    installManagedFonts(template.assets ?? [])
      .then((diagnostics) => {
        const unavailable = diagnostics.filter((face) => !face.loaded);
        if (unavailable.length)
          throw new Error(
            `${unavailable.length} managed font face${unavailable.length === 1 ? " is" : "s are"} unavailable.`,
          );
        setFontsReady(true);
      })
      .catch((error) =>
        setFontError(error instanceof Error ? error.message : String(error)),
      );
  }, [template.assets]);
  if (fontError)
    return (
      <main className="print-error">
        Managed fonts could not be loaded: {fontError}
      </main>
    );
  return (
    <main
      ref={documentRef}
      className="print-document"
      data-render-ready={fontsReady ? "true" : "false"}
      data-native-page={nativePage}
    >
      {(nativePage === undefined ? visiblePages : visiblePages.slice(nativePage, nativePage + 1))
        .map((page) => (
          <section
            key={page.id}
            id={page.anchor}
            className="print-page page-canvas"
            data-page-id={page.id}
            data-page-anchor={page.anchor}
            style={{
              width: page.width,
              height: page.height,
              backgroundColor: page.background,
            }}
          >
            {page.elements.map((element) => (
              <CanvasElement
                key={element.id}
                element={element}
                elements={page.elements}
                pageSize={page}
                settings={settings}
                data={data}
                manualOverrides={manualOverrides}
                mode="data"
                readOnly
                selected={false}
                pages={template.pages}
                zoom={1}
                onSelect={noop}
                onChange={noop}
                onInteractionStart={noop}
                onInteractionEnd={noop}
                onGuides={noop}
                onContextMenu={(event) => event.preventDefault()}
              />
            ))}
          </section>
        ))}
    </main>
  );
}
