import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClosingContent } from "../../components/ClosingContent";
import { closingPageContent } from "../../data/closingPageContent";
import { sampleTemplate } from "../../data/sampleTemplate";
import { reportElementSchema } from "../schema/reportInstancePersistence";
import { closingContentSchema, validateClosingContent } from "./closingContent";
import { withNativeClosingPages } from "./migrateClosingPages";
import { expandTemplatePages } from "../generation/repeaters";
import { sampleData } from "../../data/sampleData";

describe("native editorial closing pages", () => {
  it.each(closingPageContent.map((content, i) => [i, content] as const))("round-trips source content %s through strict persisted elements", (_, content) => {
    expect(closingContentSchema.parse(JSON.parse(JSON.stringify(content)))).toEqual(content);
    expect(validateClosingContent(content)).toEqual([]);
    const element = sampleTemplate.pages.flatMap(p => p.elements).find(e => e.type === "text" && e.closingContent?.kind === content.kind);
    expect(reportElementSchema.safeParse(element).success).toBe(true);
  });
  it("retains individual methodology bullets, footnotes and definition groups", () => {
    const [methodology, definitions] = closingPageContent;
    expect(methodology.kind === "sections" && methodology.groups.map(g => g.heading)).toEqual(["OUR MARKET", "INDUSTRIAL BUILDINGS ANALYZED", "LOGISTICS DATA", "MANUFACTURING DATA", "GOVERNMENT DATA"]);
    const markup = renderToStaticMarkup(<ClosingContent content={methodology} />);
    expect(markup).toContain("Tracked buildings are 20,000 SF");
    expect(markup).toContain("Logistics Managers Index");
    expect(definitions.kind === "sections" && definitions.groups).toHaveLength(5);
  });
  it("retains all 45 source contacts and links, filtering inactive records without mutating them", () => {
    const contacts = structuredClone(closingPageContent[2]);
    if (contacts.kind !== "contacts") throw new Error("Wrong seed");
    expect(contacts.contacts).toHaveLength(45);
    expect(contacts.departments.map(d => d.columns)).toEqual([4, 4, 3, 1, 2, 2]);
    const markup = renderToStaticMarkup(<ClosingContent content={contacts} />);
    expect(markup.match(/href="mailto:/g)).toHaveLength(45);
    expect(markup).toContain('mailto:bpappas@lee-associates.com');
    contacts.contacts[0].isActive = false;
    expect(renderToStaticMarkup(<ClosingContent content={contacts} />)).not.toContain('mailto:dalbers@lee-associates.com');
    expect(contacts.contacts).toHaveLength(45);
  });
  it("keeps corporate statistics and all 74 timeline entries as editable text", () => {
    const company = closingPageContent[3];
    if (company.kind !== "company") throw new Error("Wrong seed");
    expect(company.openings).toHaveLength(74);
    const markup = renderToStaticMarkup(<ClosingContent content={company} />);
    expect(markup).toContain("$120+"); expect(markup).toContain("1979 - Irvine, CA");
    expect(markup).not.toContain("static-pages/who-we-are");
  });
  it("rejects invalid emails, duplicate ids and unresolved departments", () => {
    const content = structuredClone(closingPageContent[2]);
    if (content.kind !== "contacts") throw new Error("Wrong seed");
    content.contacts[0].email = "javascript:bad";
    expect(closingContentSchema.safeParse(content).success).toBe(false);
    content.contacts[0].email = ""; content.contacts[0].department = "missing";
    content.contacts[1].id = content.contacts[0].id;
    expect(validateClosingContent(content)).toHaveLength(2);
  });
  it("migrates only a clone of the four closing pages and preserves legacy source templates", () => {
    const legacy = structuredClone(sampleTemplate);
    legacy.pages[6].elements = [{ id: "legacy", type: "image", name: "Legacy artwork", x: 0, y: 0, width: 816, height: 1056, src: "/report-assets/static-pages/data-methodology.png", style: {} }];
    const before = JSON.stringify(legacy);
    const next = withNativeClosingPages(legacy, sampleTemplate);
    expect(JSON.stringify(legacy)).toBe(before); expect(next.pages[0]).toEqual(legacy.pages[0]);
    expect(next.pages[6].elements.some(e => e.type === "text" && e.closingContent)).toBe(true);
  });
  it("assigns final closing-page numbers dynamically for different report lengths", () => {
    for (const selected of [[], ["I-55 Corridor"]]) {
      const pages = expandTemplatePages(sampleTemplate, sampleData, { submarkets: selected });
      pages.slice(-4).forEach((page, index) => expect(page.elements.find(e => e.name === "Page Number")).toMatchObject({ text: String(pages.length - 3 + index) }));
    }
  });
});
