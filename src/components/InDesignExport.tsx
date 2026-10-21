import { useEffect, useState } from "react";
interface Job {
  id: string;
  state: string;
  message: string;
}
/** The click is the explicit operator action; polling never dispatches or retries Adobe. */
export function InDesignExport({
  reportId,
  revision,
  disabled,
}: {
  reportId: string;
  revision: number;
  disabled: boolean;
}) {
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!job || ["complete", "failed"].includes(job.state)) return;
    const timer = setInterval(
      () =>
        void fetch(`/api/indesign/jobs/${job.id}`)
          .then(async (r) => {
            const body = await r.json();
            if (!r.ok) throw Error(body.error);
            setJob(body);
          })
          .catch((e) => {
            setError(String(e));
            clearInterval(timer);
          }),
      1500,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.state]);
  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/indesign/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lee-desktop-action": "operator-started",
        },
        body: JSON.stringify({ reportId, revision }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setJob(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const running =
    starting || (!!job && !["complete", "failed"].includes(job.state));
  return (
    <div className="indesign-export">
      <button disabled={disabled || running} onClick={start}>
        {" "}
        {running ? "Preparing InDesign…" : "Export to InDesign"}
      </button>
      {(job || error) && (
        <div className="indesign-export-status">
          {job && <span role="status">{job.message}</span>}
          {job?.state === "complete" && (
            <a href={`/api/indesign/jobs/${job.id}/download`}>
              Download InDesign package
            </a>
          )}
          {error && <span role="alert">{error}</span>}
        </div>
      )}
    </div>
  );
}
