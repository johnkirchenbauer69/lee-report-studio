import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BrokerInterviewSet } from "../report-engine/narratives/brokerInterviews";
import type { ReportInstance } from "../report-engine/schema/generation";
import { BrokerInterviewPanel } from "./BrokerInterviewPanel";

const instance = (brokerInterviews?: BrokerInterviewSet, period = "2026 Q3") =>
  ({
    id: "report-test",
    dataSnapshot: { report: { period } },
    brokerInterviews,
  }) as unknown as ReportInstance;

const set = (status: BrokerInterviewSet["status"] = "ready"): BrokerInterviewSet => ({
  sourceType: "BROKER_INTERVIEW_CONTEXT",
  schemaVersion: 1,
  sourceFileName: "Q3 Market Report Interviews.pdf",
  fileType: "pdf",
  fileSha256: "a".repeat(64),
  uploadedAt: "2026-10-05T12:00:00.000Z",
  period: "2026 Q3",
  status,
  pageCount: 22,
  markets: [
    {
      marketId: "fox-valley",
      marketName: "Fox Valley",
      coverage: "matched",
      sectionHeadings: ["Fox Valley"],
      observations: [
        {
          contextKey: "broker.fox-valley.tenant_activity.1",
          marketId: "fox-valley",
          topic: "tenant_activity",
          statement: "Activity has been strong.",
          publicationStatus: "PUBLISHABLE",
          reasons: [],
          confidence: "broker_observation",
          speaker: null,
          speakerRole: "broker",
          question: null,
          page: 2,
        },
      ],
      warnings: [],
    },
  ],
  unmatchedSections: [],
  warnings: [],
});

const render = (value: ReportInstance) =>
  renderToStaticMarkup(<BrokerInterviewPanel instance={value} onChange={() => undefined} />);

describe("BrokerInterviewPanel", () => {
  it("is optional: shows Not uploaded with the supplemental-only helper text", () => {
    const markup = render(instance());
    expect(markup).toContain("(Optional) Upload Broker Interviews");
    expect(markup).toContain("Interview commentary will not override report metrics.");
    expect(markup).toContain(">Not uploaded<");
    expect(markup).toContain('accept=".pdf,.docx');
    expect(markup).not.toContain("Remove");
  });

  it("shows the file, Ready state, coverage, and replace/remove controls", () => {
    const markup = render(instance(set()));
    expect(markup).toContain(">Ready<");
    expect(markup).toContain("Q3 Market Report Interviews.pdf");
    expect(markup).toContain("Broker context prepared for 1 of 18 submarkets");
    expect(markup).toContain("Replace File");
    expect(markup).toContain("Remove");
  });

  it("shows Review needed for ambiguous extraction or a different quarter", () => {
    expect(render(instance(set("review_needed")))).toContain(">Review needed<");
    const mismatch = render(instance(set(), "2026 Q2"));
    expect(mismatch).toContain(">Review needed<");
    expect(mismatch).toContain("will not be used until a matching file is uploaded");
  });
});
