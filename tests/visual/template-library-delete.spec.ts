import { expect, test } from "@playwright/test";

test("draft cards expose a red Delete Draft action with cancel and confirmed persistence", async ({
  page,
}) => {
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
  const created = (await createResponse.json()) as {
    id: string;
    version: string;
  };
  const createdUrl = `/api/templates/${encodeURIComponent(created.id)}/versions/${encodeURIComponent(created.version)}`;

  try {
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: /Templates/ }).click();
    const publishedCard = page
      .locator(".template-version-list section")
      .filter({ hasText: /· published/ })
      .first();
    if (await publishedCard.count()) {
      await expect(publishedCard).toBeVisible();
      await expect(
        publishedCard.getByRole("button", { name: "Delete Draft" }),
      ).toHaveCount(0);
    }
    const card = page
      .locator(".template-version-list section")
      .filter({ hasText: `v${created.version} · draft` });
    await expect(card).toBeVisible();
    const deleteButton = card.getByRole("button", { name: "Delete Draft" });
    await expect(deleteButton).toBeVisible();
    await expect(deleteButton).toHaveCSS("color", "rgb(180, 35, 53)");

    await card
      .getByRole("button", { name: `More actions for v${created.version}` })
      .click();
    await expect(
      card.getByRole("menuitem", { name: "Open version" }),
    ).toBeVisible();
    await expect(
      card.getByRole("menuitem", { name: "Duplicate as new draft" }),
    ).toBeVisible();
    await card.getByRole("menuitem", { name: "View version history" }).click();
    await expect(page.locator(".toast")).toContainText(
      "All versions are shown",
    );

    await deleteButton.click();
    const dialog = page.getByRole("dialog", {
      name: `Delete draft v${created.version}`,
    });
    await expect(dialog).toContainText(
      "Published templates, shared managed assets, and previously generated reports will not be affected.",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await page.request.get(createdUrl)).status()).toBe(200);

    await deleteButton.click();
    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(createdUrl),
    );
    await dialog.getByRole("button", { name: "Delete Draft" }).click();
    expect((await deletion).status()).toBe(204);
    await expect(card).toHaveCount(0);
    expect((await page.request.get(createdUrl)).status()).toBe(404);
    expect(
      (
        await page.request.get(
          `/api/templates/${encodeURIComponent(source.id)}/versions/${encodeURIComponent(source.version)}`,
        )
      ).status(),
    ).toBe(200);
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});
