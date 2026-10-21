import { expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { editableCanonicalEdition } from "./editableCanonicalEdition";
import { sanitizeSalesforceClientPayload } from "../../src/shared/salesforceIds";
import type { Asset } from "../../src/types/report";
it("pins display-safe asset names before hashing without changing asset provenance", () => {
  const asset = {
    id: "asset-1",
    name: "salesforce-00PVy00000YNrcjMAD",
    type: "image",
    source: "/api/assets/asset-1/content",
    checksum: "unchanged",
    storageKey: "original.png",
  } as Asset;
  const source = { ...sampleTemplate, id: "industrial-market-classic" };
  const result = editableCanonicalEdition(source, [asset]);
  expect(result.assets?.[0]).toEqual({
    ...asset,
    name: "salesforce-Salesforce record",
  });
  expect(sanitizeSalesforceClientPayload(result)).toEqual(result);
  expect(asset.name).toBe("salesforce-00PVy00000YNrcjMAD");
});
it("replaces only flattened closing bodies and preserves edition-specific headers and footer bindings", () => {
  const source = structuredClone(sampleTemplate);
  source.id = "industrial-market-classic";
  const page = source.pages.find((page) => page.id === "contacts")!;
  page.elements = page.elements.filter(
    (e) => !("closingContent" in e && e.closingContent),
  );
  page.elements.push({
    id: "contacts-artwork",
    name: "Flattened contacts",
    type: "image",
    src: "data:image/png;base64,old",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    style: {},
  });
  const footer = page.elements.find((e) => e.type === "text")!;
  if (footer.type === "text") footer.text = "Pinned organization address";
  const before = JSON.stringify(source),
    result = editableCanonicalEdition(source, []);
  expect(JSON.stringify(source)).toBe(before);
  const updated = result.pages.find((page) => page.id === "contacts")!;
  expect(updated.elements.some((e) => e.id === "contacts-artwork")).toBe(false);
  expect(
    updated.elements.some((e) => "closingContent" in e && e.closingContent),
  ).toBe(true);
  expect(updated.elements.find((e) => e.id === footer.id)).toMatchObject({
    text: "Pinned organization address",
  });
});
