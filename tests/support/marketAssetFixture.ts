import { sampleTemplate } from "../../src/data/sampleTemplate";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import { prepareTemplateForReport } from "../../src/report-engine/generation/prepareTemplate";
import { expandTemplatePages } from "../../src/report-engine/generation/repeaters";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";

/** Synthetic QA only. Not a production market report or historical backfill. */
export async function marketAssetFixture() {
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarkets: q2SampleReport.submarkets.map((m) => m.name) },
    source: { provider: "sample" },
  });
  instance.id = "report-market-assets-synthetic-qa";
  instance.dataSnapshot.report.title = "Synthetic Market Asset QA";
  instance.dataSnapshot.report.period = "2026 Q3";
  instance.dataSnapshot.historicalPeriods.forEach((p, i) => {
    p.period = [
      "2026 Q3",
      "2026 Q2",
      "2026 Q1",
      "2025 Q4",
      "2025 Q3",
      "2025 Q2",
      "2025 Q1",
      "2024 Q4",
    ][i];
  });
  instance.dataSnapshot.historicalPeriods[0].vacancyRate = 0.0509;
  instance.dataSnapshot.historicalPeriods[1].quarterlyNetAbsorptionSf = -123456;
  instance.dataSnapshot.historicalPeriods[4].trailing12MonthNetAbsorptionSf =
    null;
  instance.dataSnapshot.availabilityBySize = [
    "20-75k SF",
    "75-150k SF",
    "150-250k SF",
    "250-500k SF",
    "500k SF+",
  ].map((bucket, i) => ({
    bucket: bucket as "20-75k SF",
    availableSf: 100000 + i * 25000,
    buildingCount: 10 + i,
  }));
  const text =
    "This is a synthetic export QA narrative. It is not market analysis.\n\nSaved paragraph two preserves punctuation, spacing, and order.";
  instance.dataSnapshot.overallMarket.narrative = text;
  for (const detail of instance.dataSnapshot.submarketDetails) {
    detail.historicalPeriods = structuredClone(
      instance.dataSnapshot.historicalPeriods,
    );
    detail.narrative = text;
    detail.leasing = structuredClone(q2SampleReport.leasing);
    detail.sales = structuredClone(q2SampleReport.sales);
    detail.availabilities = structuredClone(q2SampleReport.availabilities);
    detail.deliveries = structuredClone(q2SampleReport.deliveries);
    detail.construction = structuredClone(q2SampleReport.construction);
    detail.availabilityBySize = structuredClone(
      instance.dataSnapshot.availabilityBySize,
    );
  }
  const data = buildPresentationModel(instance.dataSnapshot);
  const prepared = prepareTemplateForReport(
    sampleTemplate,
    instance.dataSnapshot,
    data,
    "sample",
  );
  instance.pages = expandTemplatePages(prepared, data, {
    submarkets: instance.dataSnapshot.submarketDetails.map((m) => m.name),
  });
  return instance;
}
