import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, PDFDict, PDFName, PDFString } from "pdf-lib";
import { extractText } from "unpdf";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { sampleData } from "../../src/data/sampleData";
import type { StoredTemplateVersion } from "../../src/types/templateLibrary";

async function openVersion(page: Page, version: string) {
  await page.goto("/?editor=1");
  await page.locator(".rail").getByRole("button", { name: /Templates/ }).click();
  const card = page
    .locator(".template-version-list section")
    .filter({ hasText: `v${version} · draft` });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Open Draft", exact: true }).click();
}

test("native closing pages export through the production Chromium HTTP path", async ({
  request,
}) => {
  test.setTimeout(120_000);
  // No draft bypass, API mocks, or browser page.pdf shortcut: exercise publication preflight and renderer.
  const response = await request.post("/api/render/pdf", {
    data: {
      template: { ...sampleTemplate, pages: sampleTemplate.pages.slice(-4) },
      data: sampleData,
      title: "Native closing production export QA",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const bytes = await response.body();
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(4);
  expect(pdf.getProducer()).toBe("LEE Report Studio Chromium renderer");
  const { text } = await extractText(new Uint8Array(bytes), {
    mergePages: true,
  });
  for (const term of [
    "Metropolitan Areas Monitored",
    "Direct Net Absorption",
    "Dustin Albers",
    "bpappas@lee-associates.com",
    "WHO WE ARE",
    "1979 - Irvine",
  ])
    expect(text).toContain(term);
  const links = pdf
    .getPages()[2]
    .node.Annots()
    ?.asArray()
    .flatMap((ref) => {
      const action = pdf.context
        .lookup(ref, PDFDict)
        .lookupMaybe(PDFName.of("A"), PDFDict);
      const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString);
      return uri?.decodeText().startsWith("mailto:") ? [uri.decodeText()] : [];
    });
  expect(links).toHaveLength(45);
});

for (const kind of ["contacts", "company"] as const) {
  test(`${kind} records edit, reorder, save to the isolated API, and reopen`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const listing = await (await request.get("/api/templates")).json();
    const source = listing.templates[0];
    const fixture = structuredClone(sampleTemplate);
    fixture.pages = [
      fixture.pages.find(
        (p) => p.id === (kind === "contacts" ? "contacts" : "who-we-are"),
      )!,
    ];
    const created = await request.post(
      `/api/templates/${source.id}/versions/${source.version}/new`,
      { data: { template: fixture } },
    );
    expect(created.status(), await created.text()).toBe(201);
    const draft = (await created.json()) as StoredTemplateVersion;
    const url = `/api/templates/${draft.id}/versions/${draft.version}`;
    try {
      await openVersion(page, draft.version);
      await page.locator(".rail").getByTitle("Elements").click();
      await page
        .locator(".layer-list")
        .getByRole("button", {
          name:
            kind === "contacts"
              ? /Contacts Content.*text/i
              : /Who We Are Content.*text/i,
        })
        .click();
      const editor = page.locator(".closing-editor");
      const second = editor.getByRole("group", {
        name: kind === "contacts" ? "Contacts 2" : "Openings 2",
        exact: true,
      });
      await second
        .getByRole("textbox", {
          name: kind === "contacts" ? "Name" : "Market",
          exact: true,
        })
        .fill(kind === "contacts" ? "QA Contact" : "QA Office");
      if (kind === "contacts")
        await second
          .getByRole("textbox", { name: "Email", exact: true })
          .fill("qa.contact@example.com");
      else
        await second
          .getByRole("spinbutton", { name: "Year", exact: true })
          .fill("2024");
      await second
        .getByRole("button", { name: "Move up", exact: true })
        .click();
      await editor
        .getByRole("button", { name: "Apply content changes" })
        .click();
      const rendered = page.locator(
        kind === "contacts"
          ? ".closing-contact strong"
          : ".closing-timeline > div",
      );
      await expect(rendered.first()).toHaveText(
        kind === "contacts" ? "QA Contact" : "2024 - QA Office",
      );
      const saveResponse = page.waitForResponse(
        (r) => r.request().method() === "PUT" && r.url().endsWith(url),
      );
      await page
        .getByRole("banner")
        .getByRole("button", { name: "Save Draft", exact: true })
        .click();
      expect((await saveResponse).ok()).toBeTruthy();
      const saved = (await (
        await request.get(url)
      ).json()) as StoredTemplateVersion;
      const content = saved.template.pages[0].elements.find(
        (e) => e.type === "text" && e.closingContent,
      );
      if (!content || content.type !== "text")
        throw new Error("Missing saved native content");
      if (content.closingContent?.kind === "contacts") {
        expect(content.closingContent.contacts[0]).toMatchObject({
          name: "QA Contact",
          email: "qa.contact@example.com",
          displayOrder: 0,
        });
        expect(content.closingContent.contacts[1].displayOrder).toBe(1);
      } else if (content.closingContent?.kind === "company") {
        expect(content.closingContent.openings[0]).toMatchObject({
          market: "QA Office",
          year: 2024,
          displayOrder: 0,
        });
        expect(content.closingContent.openings[1].displayOrder).toBe(1);
      } else throw new Error("Unexpected closing content kind");
      await openVersion(page, draft.version);
      await expect(rendered.first()).toHaveText(
        kind === "contacts" ? "QA Contact" : "2024 - QA Office",
      );
      if (kind === "contacts")
        await expect(
          page.locator('a[href="mailto:qa.contact@example.com"]'),
        ).toHaveCount(1);
    } finally {
      expect((await request.delete(url)).status()).toBe(204);
    }
  });
}
