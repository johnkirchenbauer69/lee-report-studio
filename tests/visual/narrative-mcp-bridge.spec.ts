import { expect, test, type APIRequestContext } from "@playwright/test";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import type { ReportInstance } from "../../src/report-engine/schema/generation";

/**
 * The ChatGPT handoff, driven through a real MCP server.
 *
 * The API under test runs with NARRATIVE_GENERATION_MODE=chatgpt_mcp and an
 * empty OPENAI_API_KEY, pointed at the mock LEE Intelligence MCP started by
 * playwright.config.ts. Nothing here mocks the bridge in the browser: the
 * page talks to the local API, the API talks MCP.
 */

const mockMcp = `http://127.0.0.1:${process.env.PLAYWRIGHT_MOCK_MCP_PORT ?? "8790"}`;

async function createFixture(request: APIRequestContext) {
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  instance.id = `report-${crypto.randomUUID()}`;
  const response = await request.post("/api/report-instances", { data: instance });
  expect(response.ok()).toBeTruthy();
  return instance;
}

test("Generate All hands off to ChatGPT and imports the batch without an OpenAI API key", async ({
  page,
  request,
  context,
}) => {
  const instance = await createFixture(request);

  // The bridge decides configuration, not OPENAI_API_KEY.
  const health = await (await request.get("/api/integrations/narrative-mcp/health")).json();
  expect(health).toMatchObject({ configured: true, reachable: true });
  expect(health.missingTools).toEqual([]);
  expect(health.requiredToolsFound).toHaveLength(4);
  expect(JSON.stringify(health)).not.toMatch(/api[_-]?key|secret|token/i);

  await page.goto(`/?narrativeReview=${encodeURIComponent(instance.id)}`);
  await expect(page.getByTestId("narrative-workspace")).toBeVisible();
  await expect(page.locator(".narrative-list > button")).toHaveCount(19);
  await expect(page.getByText("AI narrative generation is not configured.")).toHaveCount(0);

  const button = page.getByRole("button", { name: "Generate All Narratives" });
  await expect(button).toBeEnabled();

  // The configured ChatGPT app URL opens in a new tab on the click itself.
  const opened = context.waitForEvent("page");
  await button.click();
  await (await opened).close();

  const panel = page.getByTestId("narrative-external-job");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Waiting for ChatGPT");
  await expect(panel).toContainText("19 narrative contexts prepared");
  await expect(panel).toContainText("Use the LEE Intelligence app to complete Report Studio narrative job");
  await expect(panel).toContainText("Waiting for LEE Intelligence to submit narratives...");
  await expect(page.getByRole("button", { name: "Copy Handoff Prompt" })).toBeVisible();
  // The 19-market list stays visible throughout the handoff.
  await expect(page.locator(".narrative-list > button")).toHaveCount(19);

  // 19 governed contexts actually reached the MCP.
  const stored = (await (await request.get(`/api/report-instances/${instance.id}`)).json()) as ReportInstance;
  const jobId = stored.externalNarrativeJob!.jobId;
  expect(stored.externalNarrativeJob).toMatchObject({
    provider: "chatgpt_mcp",
    status: "waiting_for_chatgpt",
    generationScope: "all",
  });
  expect(stored.externalNarrativeJob!.marketIds).toHaveLength(19);
  const mcpJobs = await (await request.get(`${mockMcp}/control/jobs`)).json();
  const mcpJob = mcpJobs.jobs.find((item: { jobId: string }) => item.jobId === jobId);
  expect(mcpJob.contexts).toHaveLength(19);
  expect(JSON.stringify(mcpJob.contexts)).not.toContain("internalSourceIds");

  // ChatGPT writes and submits the batch.
  const submitted = await request.post(`${mockMcp}/control/jobs/${jobId}/submit`);
  expect(submitted.ok()).toBeTruthy();

  // Report Studio detects completion by polling and imports automatically —
  // no manual JSON export or import anywhere in this flow.
  await expect(page.locator(".narrative-list .status-draft")).toHaveCount(19, {
    timeout: 30_000,
  });
  await expect(panel).toContainText("ChatGPT narratives imported");

  const imported = (await (await request.get(`/api/report-instances/${instance.id}`)).json()) as ReportInstance;
  expect(imported.externalNarrativeJob!.status).toBe("complete");
  expect(imported.narratives.filter((item) => item.status === "draft")).toHaveLength(19);
  for (const record of imported.narratives) {
    expect(record.model).toBe("chatgpt-mcp");
    expect(record.source).toBe("ai");
    expect(record.claims.length).toBeGreaterThan(0);
  }
});

test("a batch that fails grounding validation is rejected whole and leaves narratives intact", async ({
  page,
  request,
}) => {
  const instance = await createFixture(request);
  await page.goto(`/?narrativeReview=${encodeURIComponent(instance.id)}`);
  await page.getByRole("button", { name: "Generate All Narratives" }).click();
  await expect(page.getByTestId("narrative-external-job")).toContainText("Waiting for ChatGPT");

  const stored = (await (await request.get(`/api/report-instances/${instance.id}`)).json()) as ReportInstance;
  const jobId = stored.externalNarrativeJob!.jobId;
  const mcpJobs = await (await request.get(`${mockMcp}/control/jobs`)).json();
  const mcpJob = mcpJobs.jobs.find((item: { jobId: string }) => item.jobId === jobId);

  // One ungrounded number is enough to reject the whole batch.
  const narratives = mcpJob.contexts.map(
    (context: { marketId: string; promptVersion: string }, index: number) => ({
      marketId: context.marketId,
      narrative:
        index === 0
          ? "Vacancy finished the quarter at 87.3%."
          : "Conditions were measured rather than decisive during the quarter.",
      claims: [],
      contextKeysUsed: [],
      qualityFlags: [],
      promptVersion: context.promptVersion,
    }),
  );
  const submitted = await request.post(`${mockMcp}/control/jobs/${jobId}/submit-raw`, {
    data: { narratives },
  });
  expect(submitted.ok()).toBeTruthy();

  await expect(page.getByTestId("narrative-external-job")).toContainText(
    "ChatGPT returned a batch that failed Report Studio grounding validation",
    { timeout: 30_000 },
  );
  const after = (await (await request.get(`/api/report-instances/${instance.id}`)).json()) as ReportInstance;
  expect(after.narratives.filter((item) => item.status === "draft")).toHaveLength(0);
  expect(after.narratives.every((item) => item.text === "")).toBe(true);
});
