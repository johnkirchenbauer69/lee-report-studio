import { expect, test, type Page } from "@playwright/test";

const templateId = "industrial-market-report";

async function createDraft(page: Page) {
  const listResponse = await page.request.get("/api/templates");
  test.skip(
    !listResponse.ok(),
    "The durable template API is not running in this environment.",
  );
  const summaries = (await listResponse.json()) as {
    templates: Array<{ id: string; version: string }>;
  };
  const source = summaries.templates[0]!;
  const createResponse = await page.request.post(
    `/api/templates/${encodeURIComponent(source.id)}/versions/${encodeURIComponent(source.version)}/new`,
    { data: {} },
  );
  expect(createResponse.ok()).toBe(true);
  return (await createResponse.json()) as {
    id: string;
    version: string;
    revision: number;
    template: { pages: Array<{ id: string; name: string }> };
  };
}

async function openDraft(page: Page, version: string) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Templates/ }).click();
  const card = page
    .locator(".template-version-list section")
    .filter({ hasText: `v${version} · draft` });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Open Draft" }).click();
  return card;
}

test("a stale template save is rejected, not silently overwritten, and the edit is recoverable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const created = await createDraft(page);
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;

  try {
    await openDraft(page, created.version);

    // Someone/something else (another tab, a teammate, a script) saves
    // over this exact draft while the browser still has it open.
    const externalSave = await page.request.put(createdUrl, {
      data: {
        template: { ...created.template, name: "Externally changed" },
        expectedRevision: created.revision,
      },
    });
    expect(externalSave.ok(), await externalSave.text()).toBe(true);
    const external = (await externalSave.json()) as { revision: number };
    expect(external.revision).toBe(created.revision + 1);

    // The browser, still based on the original revision, edits and saves.
    await page.getByRole("button", { name: /Elements/ }).click();
    const layer = page.locator(".layer-list button").first();
    await layer.click();
    await page
      .locator(".inspector-section")
      .filter({ hasText: "Position & Size" })
      .getByLabel("Layer name")
      .fill("Browser's own edit");
    const saveButton = page
      .locator(".topbar")
      .getByRole("button", { name: "Save", exact: true });
    await saveButton.click();

    await expect(page.locator(".statusbar")).toContainText(
      "Template save conflict",
    );
    await expect(page.locator(".statusbar")).toContainText(
      `v${created.version} changed elsewhere`,
    );

    // The external save is intact — the browser's stale save never landed.
    const stored = (await (await page.request.get(createdUrl)).json()) as {
      template: { name: string };
      revision: number;
    };
    expect(stored.template.name).toBe("Externally changed");
    expect(stored.revision).toBe(created.revision + 1);

    // Reloading recovers the browser's rejected edit rather than losing it,
    // because nothing has changed server-side since the conflict was
    // reported (still revision 2) — it is safe to restore. The app's own
    // mount-time bootstrap reopens the most-recently-touched draft — this
    // one — automatically; re-opening it a second time through the UI
    // after that would just refetch the server copy and discard the
    // in-memory-only recovery, so check the state it lands on directly.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".stage-topline span").first()).toHaveText(
      "Cover",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /Templates/ }).click();
    await expect(page.locator(".master-mode-card")).toContainText(
      `v${created.version}`,
    );
    await page.getByRole("button", { name: /Elements/ }).click();
    await expect(
      page.locator(".layer-list button").first(),
    ).toContainText("Browser's own edit");
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});

test("a draft version can be given a custom label that persists and survives reload", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const created = await createDraft(page);
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;

  try {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Templates/ }).click();
    const card = page
      .locator(".template-version-list section")
      .filter({ hasText: `v${created.version} · draft` });
    await expect(card).toBeVisible();

    await card
      .getByRole("button", { name: `More actions for v${created.version}` })
      .click();
    await card.getByRole("menuitem", { name: "Rename" }).click();
    await card.getByLabel(`Label for v${created.version}`).fill("Q3 2026 working draft");
    await card.getByRole("button", { name: "Save", exact: true }).click();

    await expect(card.locator("strong")).toHaveText("Q3 2026 working draft");
    await expect(page.locator(".toast")).toContainText("renamed");

    const stored = (await (await page.request.get(createdUrl)).json()) as {
      label?: string;
      name: string;
    };
    expect(stored.label).toBe("Q3 2026 working draft");
    expect(stored.name).toBe("Industrial Market Report");

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Templates/ }).click();
    await expect(
      page
        .locator(".template-version-list section")
        .filter({ hasText: `v${created.version} · draft` })
        .locator("strong"),
    ).toHaveText("Q3 2026 working draft");
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});
