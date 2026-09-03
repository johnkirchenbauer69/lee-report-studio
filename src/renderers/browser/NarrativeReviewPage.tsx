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
  // Matches the wizard's final step: the editor stays reachable while
  // narratives are still in draft, and PDF export is what publication
  // readiness gates.
  const openReportEditor = () => {
    reportInstanceStore.remember(instance.id);
    window.location.assign("/");
  };
  const approved = instance.narratives.filter(
    (record) => record.status === "approved",
  ).length;
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
        <footer>
          <span className="narrative-review-readiness">
            {approved} approved / {instance.narratives.length} required ·{" "}
            {instance.readiness.canPublish
              ? "Ready to publish"
              : `${instance.readiness.blockers.length} publication blockers`}
          </span>
          <div>
            <button
              className="primary"
              data-testid="open-report-editor"
              onClick={openReportEditor}
            >
              Open Report Editor
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
