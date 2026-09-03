import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import { CHICAGO_SUBMARKETS } from "../../src/report-engine/submarkets";

async function approvedFixture(text: (name: string) => string) {
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: {
      submarketIds: CHICAGO_SUBMARKETS.map((item) => item.id),
    },
    source: { provider: "sample" },
  });
  instance.narratives = instance.narratives.map((record) => ({
    ...record,
    text: text(record.marketName),
    status: "approved" as const,
    source: "manual" as const,
    wordCount: text(record.marketName).trim().split(/\s+/).length,
    approvedAt: "2026-09-03T12:00:00.000Z",
  }));
  instance.dataSnapshot.overallMarket.narrative = text("Overall Market");
  instance.dataSnapshot.submarketDetails.forEach((detail) => {
    detail.narrative = text(detail.displayName ?? detail.name);
  });
  return instance;
}

test("approved narrative fixtures render through Chromium across the 44-page architecture", async ({ request }) => {
  test.setTimeout(120_000);
  const instance = await approvedFixture(
    (name) => `${name} maintained balanced industrial fundamentals during the quarter, with the governed metrics and publication-safe transactions informing the market narrative.`,
  );
  expect(instance.pages).toHaveLength(44);
  expect(instance.dataSnapshot.submarketDetails.every((item) => item.narrative.length > 0)).toBe(true);
  const response = await request.post("/api/render/pdf", {
    data: {
      template: { ...sampleTemplate, pages: instance.pages },
      data: buildPresentationModel(instance.dataSnapshot),
      title: "Approved narrative fixture",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const pdf = await PDFDocument.load(await response.body());
  expect(pdf.getPageCount()).toBe(44);
});

test("Chromium publication rendering blocks a narrative that exceeds its actual box", async ({ request }) => {
  test.setTimeout(120_000);
  const instance = await approvedFixture(() => Array(800).fill("overflow").join(" "));
  const response = await request.post("/api/render/pdf", {
    data: {
      template: { ...sampleTemplate, pages: instance.pages },
      data: buildPresentationModel(instance.dataSnapshot),
      title: "Overflow narrative fixture",
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("Narrative overflow blocks publication");
});
