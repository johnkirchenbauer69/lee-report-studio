import { useEffect, useState } from "react";
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
}

export function PrintReport({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    fetch(`/api/render-jobs/${encodeURIComponent(jobId)}`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Render job unavailable")),
      )
      .then(setJob)
      .catch((reason) => setError(String(reason)));
  }, [jobId]);
  if (error) return <main className="print-error">{error}</main>;
  if (!job) return <main className="print-loading">Preparing report…</main>;
  return <PrintPages template={job.template} data={job.data} />;
}

export function BenchmarkPrintReport() {
  return <PrintPages template={sampleTemplate} data={sampleData} />;
}

function PrintPages({
  template,
  data,
}: {
  template: ReportTemplate;
  data: unknown;
}) {
  const [fontsReady, setFontsReady] = useState(false);
  const [fontError, setFontError] = useState<string>();
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
      className="print-document"
      data-render-ready={fontsReady ? "true" : "false"}
    >
      {template.pages
        .filter((page) => !page.hidden)
        .map((page) => (
          <section
            key={page.id}
            className="print-page page-canvas"
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
                mode="data"
                selected={false}
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
