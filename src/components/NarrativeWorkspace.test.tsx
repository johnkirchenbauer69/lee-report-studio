import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExternalJobPanel } from "./NarrativeWorkspace";
import type { ExternalNarrativeJob } from "../report-engine/schema/generation";

const noop = () => undefined;

const baseJob: ExternalNarrativeJob = {
  provider: "chatgpt_mcp",
  jobId: "narrative-attempt-11111111-2222-3333-4444-555555555555",
  idempotencyKey: "narrative-attempt-11111111-2222-3333-4444-555555555555",
  status: "failed",
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:01.000Z",
  marketIds: Array.from({ length: 19 }, (_, index) => `market-${index}`),
  generationScope: "all",
};

const render = (job: ExternalNarrativeJob) =>
  renderToStaticMarkup(
    <ExternalJobPanel
      job={job}
      copied={false}
      busy={false}
      onOpenApp={noop}
      onCopy={noop}
      onRetryImport={noop}
      onRetryCreate={noop}
    />,
  );

describe("ExternalJobPanel", () => {
  it("shows the structured remote code and market instead of the generic banner", () => {
    const markup = render({
      ...baseJob,
      error: "PROMPT_PROFILE_MISMATCH: Submitted promptProfile does not match the governed narrative-v2 profile.",
      errorCode: "PROMPT_PROFILE_MISMATCH",
      errorMarketId: "ohare",
    });
    expect(markup).toContain("Narrative job creation failed");
    expect(markup).toContain("Code:");
    expect(markup).toContain("PROMPT_PROFILE_MISMATCH");
    expect(markup).toContain("Market:");
    expect(markup).toContain("O&#x27;Hare");
    expect(markup).toContain(
      "Submitted promptProfile does not match the governed narrative-v2 profile.",
    );
    // The code is not duplicated: it appears once in the "Code:" segment,
    // not again as a raw prefix on the trailing detail text.
    expect(markup.match(/PROMPT_PROFILE_MISMATCH/g)).toHaveLength(1);
    expect(markup).toContain("Retry Generate All");
    expect(markup).not.toContain("Retry Import<");
  });

  it("falls back to the generic banner only when the remote gave no structured code", () => {
    const markup = render({
      ...baseJob,
      error: "The remote narrative job could not be created. Retry Generate All.",
      errorCode: "NARRATIVE_JOB_CREATE_FAILED",
    });
    expect(markup).toContain("Narrative job creation failed");
    expect(markup).toContain("NARRATIVE_JOB_CREATE_FAILED");
    expect(markup).toContain(
      "The remote narrative job could not be created. Retry Generate All.",
    );
    expect(markup).not.toContain("Market:");
  });

  it("still shows the ChatGPT batch-rejected path (no errorCode) with Retry Import", () => {
    const markup = render({
      ...baseJob,
      error: "ChatGPT returned a batch that failed Report Studio grounding validation.",
    });
    expect(markup).toContain("ChatGPT batch rejected");
    expect(markup).toContain("Retry Import");
    expect(markup).not.toContain("Retry Generate All");
    expect(markup).not.toContain("Narrative job creation failed");
  });

  it("renders the waiting state with no error banner", () => {
    const markup = render({ ...baseJob, status: "waiting_for_chatgpt", error: undefined, errorCode: undefined });
    expect(markup).toContain("Waiting for ChatGPT");
    expect(markup).not.toContain("narrative-error");
  });
});
