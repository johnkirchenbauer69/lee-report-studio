import { expect, test, type Page } from "@playwright/test";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";

const PX_PER_PT = 96 / 72;

async function printJobWithOverallNarrative(page: Page, narrative: string) {
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  instance.dataSnapshot.overallMarket.narrative = narrative;
  const job = {
    template: { ...sampleTemplate, pages: instance.pages },
    data: buildPresentationModel(instance.dataSnapshot),
    title: "Narrative font fit",
  };
  await page.route("**/api/render-jobs/font-fit", (route) =>
    route.fulfill({ json: job }),
  );
  await page.goto("/?printJob=font-fit");
  await page.waitForSelector('[data-render-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => !document.querySelector('[data-narrative-fit="pending"]'),
  );
  return page.evaluate(() => {
    const host = document.querySelector('[data-narrative-id="overall-market"]')!;
    const text = host.querySelector(".text-value") as HTMLElement;
    const container = text.parentElement!;
    return {
      authoredPx: Number.parseFloat(getComputedStyle(host).fontSize),
      renderedPx: Number.parseFloat(getComputedStyle(text).fontSize),
      fit: text.dataset.narrativeFit,
      overflow: text.dataset.narrativeOverflow,
      contentHeight: text.scrollHeight,
      availableHeight: container.clientHeight,
    };
  });
}

test("short narratives grow up to +2 pt and still fit their box", async ({ page }) => {
  const measured = await printJobWithOverallNarrative(
    page,
    "Demand held steady across the region as leasing concentrated in a few large commitments.",
  );
  expect(measured.fit).toBe("done");
  expect(measured.overflow).toBe("false");
  expect(measured.renderedPx).toBeGreaterThan(measured.authoredPx);
  expect(measured.renderedPx).toBeLessThanOrEqual(measured.authoredPx + 2 * PX_PER_PT + 0.01);
  // 0.25 pt increments.
  const steps = (measured.renderedPx - measured.authoredPx) / (0.25 * PX_PER_PT);
  expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.01);
  expect(measured.contentHeight).toBeLessThanOrEqual(measured.availableHeight);
});

test("overflowing narratives stay at the authored minimum and report overflow", async ({ page }) => {
  const measured = await printJobWithOverallNarrative(
    page,
    Array(800).fill("overflow").join(" "),
  );
  expect(measured.renderedPx).toBe(measured.authoredPx);
  expect(measured.overflow).toBe("true");
});

test("the PDF renderer reports narrative overflow measured at the minimum size", async ({ request }) => {
  test.setTimeout(120_000);
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  instance.dataSnapshot.overallMarket.narrative = Array(800).fill("overflow").join(" ");
  const response = await request.post("/api/render/pdf", {
    data: {
      template: { ...sampleTemplate, pages: instance.pages },
      data: buildPresentationModel(instance.dataSnapshot),
      title: "Overflow narrative fixture",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()["x-lee-narrative-overflow"]).toContain("overall-market");
});
