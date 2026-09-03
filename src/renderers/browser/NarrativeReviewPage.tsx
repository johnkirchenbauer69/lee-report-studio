import { useEffect, useState } from "react";
import { NarrativeWorkspace } from "../../components/NarrativeWorkspace";
import type { ReportInstance } from "../../report-engine/schema/generation";
import { reportInstanceStore } from "../../services/reportInstanceStore";

export function NarrativeReviewPage({ reportInstanceId }: { reportInstanceId: string }) {
  const [instance, setInstance] = useState<ReportInstance>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    reportInstanceStore
      .get(reportInstanceId)
      .then(setInstance)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [reportInstanceId]);
  if (error) return <main className="print-error">{error}</main>;
  if (!instance) return <main className="print-loading">Loading narratives…</main>;
  return (
    <main style={{ padding: 24, background: "#eef2f4", minHeight: "100vh" }}>
      <section className="report-wizard" style={{ margin: "0 auto", maxHeight: "none" }}>
        <header>
          <div>
            <span className="eyebrow">REPORT GENERATOR</span>
            <h2>Narrative Review</h2>
            <p>{instance.generationRequest.period} · {instance.generationRequest.market}</p>
          </div>
        </header>
        <div className="wizard-body">
          <NarrativeWorkspace instance={instance} onChange={setInstance} />
        </div>
      </section>
    </main>
  );
}
