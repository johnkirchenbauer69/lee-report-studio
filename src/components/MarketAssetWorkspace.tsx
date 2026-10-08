import { useEffect, useState } from "react";
import {
  CATEGORIES,
  type Category,
  type ExportJob,
  type ExportPlan,
} from "../report-engine/market-assets/contracts";
import "../styles/market-assets.css";

type SavedReport = {
  id: string;
  name: string;
  period: string;
  status: string;
  generatedAt: string;
  templateVersion: string;
  revision: number;
};
type ReportDetails = SavedReport & {
  snapshotHash: string;
  markets: { id: string; name: string; pages: number }[];
  warning?: string;
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/market-assets${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The export request failed.");
  return data;
}
export function MarketAssetWorkspace() {
  const [reports, setReports] = useState<SavedReport[]>([]),
    [report, setReport] = useState<ReportDetails>();
  const [markets, setMarkets] = useState<string[]>([]),
    [categories, setCategories] = useState<Category[]>(
      Object.keys(CATEGORIES) as Category[],
    );
  const [search, setSearch] = useState(""),
    [resolution, setResolution] = useState<"high" | "standard">("high"),
    [transparent, setTransparent] = useState(false);
  const [plan, setPlan] = useState<ExportPlan>(),
    [job, setJob] = useState<ExportJob>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const active =
    !!job &&
    ["queued", "validating", "rendering", "packaging"].includes(job.state);
  useEffect(() => {
    api<SavedReport[]>("/reports")
      .then(setReports)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!active || !job) return;
    const timer = window.setInterval(
      () =>
        api<ExportJob>(`/jobs/${job.id}`)
          .then(setJob)
          .catch((e) => {
            setError(e.message);
            window.clearInterval(timer);
          }),
      1500,
    );
    return () => window.clearInterval(timer);
  }, [active, job?.id]);
  const invalidate = () => {
    setPlan(undefined);
    setError("");
  };
  const request = {
    reportId: report?.id,
    markets,
    categories,
    resolution,
    transparent,
  };
  const toggleMarket = (id: string) => {
    invalidate();
    setMarkets((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    );
  };
  const toggleCategory = (id: Category) => {
    invalidate();
    setCategories((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };
  const loadReport = async (id: string) => {
    invalidate();
    setReport(undefined);
    setMarkets([]);
    if (!id) return;
    setLoading(true);
    try {
      const details = await api<ReportDetails>(
        `/reports/${encodeURIComponent(id)}`,
      );
      setReport(details);
      setMarkets(details.markets.map((m) => m.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const preview = async () => {
    setError("");
    setLoading(true);
    try {
      setPlan(await api<ExportPlan>("/preview", request));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const start = async () => {
    if (!plan) return;
    setError("");
    setLoading(true);
    try {
      setJob(
        await api<ExportJob>("/jobs", {
          ...request,
          revision: plan.revision,
          snapshotHash: plan.snapshotHash,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const finished =
    job && ["completed", "completed_with_warnings"].includes(job.state);
  return (
    <div className="asset-workspace">
      <header className="asset-header">
        <a href="/">LEE Report Studio</a>
        <nav aria-label="Primary navigation">
          <a href="/">Report Editor</a>
          <a href="/?marketAssets=1" aria-current="page">
            Market Assets
          </a>
        </nav>
      </header>
      <main>
        <div className="asset-intro">
          <p className="asset-eyebrow">LEE &amp; ASSOCIATES</p>
          <h1>Market Asset Export</h1>
          <p>Export selected markets and assets from a saved report.</p>
        </div>
        {error && (
          <div className="asset-warning" role="alert">
            {error}
          </div>
        )}
        <section className="asset-card" aria-labelledby="saved-report-heading">
          <h2 id="saved-report-heading">1. Saved report</h2>
          <label className="asset-field">
            Report
            <select
              aria-label="Saved report"
              disabled={loading || active}
              value={report?.id ?? ""}
              onChange={(e) => void loadReport(e.target.value)}
            >
              <option value="">Select a saved report</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.period} · {r.status.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {!reports.length && (
            <p>
              No saved reports are available. Save a generated report in the
              editor first.
            </p>
          )}
          {report && (
            <>
              <dl className="asset-metadata">
                <div>
                  <dt>Reporting period</dt>
                  <dd>{report.period}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{report.status.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Generated</dt>
                  <dd>{new Date(report.generatedAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt>Template version</dt>
                  <dd>{report.templateVersion}</dd>
                </div>
              </dl>
              {report.warning && (
                <p className="asset-warning">{report.warning}</p>
              )}
            </>
          )}
        </section>
        {report && (
          <>
            <div className="asset-columns">
              <section className="asset-card" aria-labelledby="markets-heading">
                <h2 id="markets-heading">
                  2. Markets <span>{markets.length} selected</span>
                </h2>
                <label className="asset-field">
                  Find a market
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search saved markets"
                  />
                </label>
                <div className="asset-actions">
                  <button
                    disabled={active}
                    onClick={() => {
                      invalidate();
                      setMarkets(report.markets.map((m) => m.id));
                    }}
                  >
                    Select all markets
                  </button>
                  <button
                    disabled={active}
                    onClick={() => {
                      invalidate();
                      setMarkets([]);
                    }}
                  >
                    Clear markets
                  </button>
                </div>
                <div className="asset-market-list">
                  {report.markets
                    .filter((m) =>
                      m.name
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()),
                    )
                    .map((m) => (
                      <label className="asset-check" key={m.id}>
                        <input
                          type="checkbox"
                          disabled={active}
                          checked={markets.includes(m.id)}
                          onChange={() => toggleMarket(m.id)}
                        />
                        <span>
                          {m.name}
                          <small>{m.pages} saved pages</small>
                        </span>
                      </label>
                    ))}
                </div>
              </section>
              <section
                className="asset-card"
                aria-labelledby="categories-heading"
              >
                <h2 id="categories-heading">
                  3. Asset categories <span>{categories.length} selected</span>
                </h2>
                <div className="asset-actions">
                  <button
                    disabled={active}
                    onClick={() => {
                      invalidate();
                      setCategories(Object.keys(CATEGORIES) as Category[]);
                    }}
                  >
                    Select all categories
                  </button>
                  <button
                    disabled={active}
                    onClick={() => {
                      invalidate();
                      setCategories([]);
                    }}
                  >
                    Clear categories
                  </button>
                </div>
                {(Object.keys(CATEGORIES) as Category[]).map((key) => (
                  <label className="asset-check" key={key}>
                    <input
                      type="checkbox"
                      disabled={active}
                      checked={categories.includes(key)}
                      onChange={() => toggleCategory(key)}
                    />
                    <span>
                      {CATEGORIES[key].label}
                      <small>
                        {CATEGORIES[key].formats
                          .map((f) => f.toUpperCase())
                          .join(" + ")}
                        {plan && categories.includes(key)
                          ? ` · ${plan.assets.filter((a) => a.category === key).length} files available`
                          : ""}
                      </small>
                    </span>
                  </label>
                ))}
              </section>
            </div>
            <section className="asset-card">
              <h2>4. PNG options</h2>
              <div className="asset-options">
                <label className="asset-field">
                  Resolution
                  <select
                    aria-label="PNG resolution"
                    disabled={active}
                    value={resolution}
                    onChange={(e) => {
                      invalidate();
                      setResolution(e.target.value as "high" | "standard");
                    }}
                  >
                    <option value="high">High · 2400 pixels wide</option>
                    <option value="standard">
                      Standard · 1200 pixels wide
                    </option>
                  </select>
                </label>
                <label className="asset-check">
                  <input
                    type="checkbox"
                    disabled={active}
                    checked={transparent}
                    onChange={(e) => {
                      invalidate();
                      setTransparent(e.target.checked);
                    }}
                  />
                  <span>
                    Transparent PNG background
                    <small>
                      Existing shapes and source images retain their
                      backgrounds.
                    </small>
                  </span>
                </label>
              </div>
            </section>
            <section className="asset-card">
              <h2>5. Export preview</h2>
              <button
                className="asset-primary"
                disabled={
                  !markets.length || !categories.length || active || loading
                }
                onClick={() => void preview()}
              >
                {loading ? "Preparing…" : "Preview export"}
              </button>
              {plan && (
                <div className="asset-preview">
                  <h3>{plan.zipName}</h3>
                  <p>
                    {plan.selectedMarkets.length} markets ·{" "}
                    {plan.categories.length} categories · {plan.assets.length}{" "}
                    expected files
                  </p>
                  <p>
                    {plan.reportName} · {plan.period} ·{" "}
                    {plan.status.toUpperCase()} · Revision {plan.revision}
                  </p>
                  <ul>
                    {plan.categories.map((category) => (
                      <li key={category}>
                        {CATEGORIES[category].label}:{" "}
                        {
                          plan.assets.filter((a) => a.category === category)
                            .length
                        }{" "}
                        files (
                        {CATEGORIES[category].formats.join(", ").toUpperCase()})
                      </li>
                    ))}
                  </ul>
                  <p>
                    Files that cannot be reproduced from saved assets will be
                    listed as omissions in the manifest.
                  </p>
                  {plan.warnings.length > 0 && (
                    <details open>
                      <summary>
                        {plan.warnings.length} availability warnings
                      </summary>
                      <ul>
                        {plan.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <button
                    className="asset-primary"
                    disabled={active || loading || !plan.assets.length}
                    onClick={() => void start()}
                  >
                    Generate ZIP
                  </button>
                </div>
              )}
            </section>
          </>
        )}
        {job && (
          <section className="asset-card asset-job" aria-live="polite">
            <h2>Export {job.state.replaceAll("_", " ")}</h2>
            <p>{job.reportName}</p>
            <progress value={job.completed} max={job.total} />
            <p>
              {job.completed} of {job.total} assets processed
            </p>
            {job.current && <p>{job.current}</p>}
            {active && job.state !== "packaging" && (
              <button
                onClick={() =>
                  void api<ExportJob>(`/jobs/${job.id}/cancel`, {})
                    .then(setJob)
                    .catch((e) => setError(e.message))
                }
              >
                Cancel export
              </button>
            )}
            {job.error && (
              <p role="alert" className="asset-warning">
                {job.error}
              </p>
            )}
            {finished && (
              <>
                <a
                  className="asset-primary"
                  href={`/api/market-assets/jobs/${job.id}/download`}
                >
                  Download {job.zipName}
                </a>
                <p>
                  Available until {new Date(job.expiresAt).toLocaleString()}.
                  The ZIP includes ExportManifest.json.
                </p>
              </>
            )}
            {job.warnings.length > 0 && (
              <details>
                <summary>{job.warnings.length} warnings and omissions</summary>
                <ul>
                  {job.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
