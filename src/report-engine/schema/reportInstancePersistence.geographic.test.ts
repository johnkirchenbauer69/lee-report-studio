import { expect, it } from "vitest";
import { reportElementSchema } from "./reportInstancePersistence";
const base = { id: "test", name: "Test", x: 0, y: 0, width: 100, height: 100, style: {} };
it("preserves optional listing bindings and shadow-free charts across persistence", () => {
  const photo = { ...base, type: "image", src: "", linkUrl: "https://buildout.com/listing", linkBinding: { path: "market.featuredCard.listingUrl" } };
  expect(reportElementSchema.parse(photo)).toEqual(photo);
  const chart = { ...base, type: "chart", sourcePath: "series", categoryPath: "period", chartType: "bar", chartStyle: { shadow: false } };
  expect(reportElementSchema.parse(chart)).toEqual(chart);
  expect(reportElementSchema.safeParse({ ...photo, linkUrl: "javascript:alert(1)" }).success).toBe(false);
});
