import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as fontkit from "fontkit";
import { getDocumentProxy } from "unpdf";
import type { FrozenPresentation } from "../market-assets/snapshot.ts";

/** Resolve the same frozen browser layout into native frames and linked artwork.
 * This never reads Salesforce, changes a report or reconstructs text from a PDF. */
export async function captureNativeLayout(
  job: FrozenPresentation,
  url: string,
  directory: string,
  progress: (message: string) => void = () => {},
) {
  await mkdir(path.join(directory, "Links"), { recursive: true });
  await mkdir(path.join(directory, "Document fonts"), { recursive: true });
  const fontNames: Record<string, string> = {};
  const fontFaces: {
    family: string;
    weight: number;
    style: string;
    name: string;
  }[] = [];
  const nativeFonts: { family: string; style: string; postscript: string }[] =
    [];
  const fontLicenses: string[] = [];
  for (const asset of job.template.assets ?? []) {
    if (asset.type !== "font") continue;
    if (!asset.source.startsWith("data:"))
      throw Error("Native fonts must be frozen");
    const bytes = Buffer.from(asset.source.split(",")[1]!, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== asset.checksum)
      throw Error("Native font checksum mismatch");
    const font = fontkit.create(bytes) as fontkit.Font;
    const names = (font as any).name.records;
    const family = names.preferredFamily?.en || font.familyName,
      style = names.preferredSubfamily?.en || font.subfamilyName;
    fontNames[asset.id] = family + "\t" + style;
    fontFaces.push({
      family: asset.fontFamily!,
      weight: asset.fontWeight ?? 400,
      style: asset.fontStyle ?? "normal",
      name: fontNames[asset.id]!,
    });
    nativeFonts.push({ family, style, postscript: font.postscriptName });
    // Approved embedding alone is not permission to redistribute font files.
    const license = asset.license?.type ?? "";
    const internalLicense =
      /organization-owned commercial/i.test(license) &&
      !!asset.license?.attestedAt &&
      !!asset.license?.attestedBy &&
      /internal organization use only/i.test(asset.license?.usageScope ?? "");
    if (
      !/OFL|open.font|apache|public.domain/i.test(license) &&
      !internalLicense
    )
      throw Error(
        `Portable font permission is not recorded for ${asset.fontFamily}. Record redistribution permission before packaging.`,
      );
    await writeFile(
      path.join(
        directory,
        "Document fonts",
        asset.checksum.slice(0, 24) +
          (asset.mimeType.includes("otf") ? ".otf" : ".ttf"),
      ),
      bytes,
      { flag: "wx" },
    );
    fontLicenses.push(
      `${font.fullName}: ${license}; ${asset.license?.usageScope ?? ""}`,
    );
  }
  await writeFile(
    path.join(directory, "Document fonts", "OFL.txt"),
    await readFile(new URL("./licenses/OFL.txt", import.meta.url)),
    { flag: "wx" },
  );
  await writeFile(
    path.join(directory, "Font-licenses.txt"),
    fontLicenses.join("\n"),
    { flag: "wx" },
  );
  await writeFile(
    path.join(directory, "Document fonts", "Font-licenses.txt"),
    "Internal organization use only. Do not redistribute commercial fonts publicly.\n" +
      fontLicenses.join("\n"),
    { flag: "wx" },
  );
  const browser = await chromium.launch({ headless: true, timeout: 30000 });
  const deadline = setTimeout(() => void browser.close(), 180000);
  try {
    const page = await browser.newPage({
      viewport: { width: 816, height: 1056 },
    });
    await page.addInitScript("window.__name = (value) => value");
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(url).origin ||
      /^(data:|blob:)/.test(route.request().url())
        ? route.continue()
        : route.abort(),
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-render-ready="true"]', {
      timeout: 60000,
    });
    await page.waitForFunction(
      () =>
        document.fonts.status === "loaded" &&
        Array.from(document.images).every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      undefined,
      { timeout: 60000 },
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("lee:refit-narratives")),
    );
    await page.waitForFunction(
      () => !document.querySelector('[data-narrative-fit="pending"]'),
    );
    const overflow = await page
      .locator('[data-narrative-overflow="true"]')
      .count();
    if (overflow) throw Error("Narrative overflow blocks native export");
    const css = await page
      .locator("#lee-managed-font-faces")
      .textContent()
      .catch(() => "");
    // Read only placement baselines from Chromium; all editable content remains
    // the frozen report/DOM text, never reconstructed from the PDF.
    const geometryPdf = await getDocumentProxy(
      new Uint8Array(
        await page.pdf({ printBackground: true, preferCSSPageSize: true }),
      ),
    );
    const model: any[] = [];
    for (const [pi, sourcePage] of job.template.pages
      .filter((p) => !p.hidden)
      .entries()) {
      const textItems = (
        await (await geometryPdf.getPage(pi + 1)).getTextContent()
      ).items.filter((item: any) => typeof item.str === "string") as any[];
      const baseline = (r: any, text: string) => {
        const hits = textItems.filter(
          (item) =>
            item.str.trim() &&
            (text.includes(item.str.trim()) ||
              item.str.includes(text.trim())) &&
            item.transform[4] >= r.x * 0.75 - 1 &&
            item.transform[4] <= (r.x + r.width) * 0.75 + 1 &&
            792 - item.transform[5] >= r.y * 0.75 &&
            792 - item.transform[5] <= (r.y + r.height) * 0.75 + 1,
        );
        return hits.length
          ? Math.min(
              ...hits.map((item) => 792 - item.transform[5] - r.y * 0.75),
            )
          : undefined;
      };
      progress(`Preparing native page ${pi + 1}: ${sourcePage.name}`);
      const pageLocator = page.locator("section.print-page").nth(pi);
      for (const source of sourcePage.elements.filter((e) => !e.hidden)) {
        const loc = pageLocator.getByTestId(source.id);
        if (!(await loc.count())) continue;
        const dom = await loc.evaluate((node) => {
          const base = node.closest(".print-page")!.getBoundingClientRect();
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return {
              x: r.x - base.x,
              y: r.y - base.y,
              width: r.width,
              height: r.height,
            };
          };
          const style = (el: Element) => {
            const s = getComputedStyle(el);
            return {
              fontFamily: s.fontFamily,
              fontStyle: s.fontStyle,
              fontSize: parseFloat(s.fontSize),
              lineHeight:
                parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2,
              color: s.color,
              fontWeight: s.fontWeight,
              textAlign: s.textAlign,
              background: s.backgroundColor,
              paddingLeft: parseFloat(s.paddingLeft),
              paddingRight: parseFloat(s.paddingRight),
            };
          };
          const text =
            node.querySelector(".text-value") ||
            node.querySelector(".text-content") ||
            node;
          const im = node.querySelector("img");
          const closing = node.querySelector(".closing-content");
          const closingItems: any[] = [];
          if (closing) {
            for (const el of [closing, ...closing.querySelectorAll("*")]) {
              const s = getComputedStyle(el),
                r = rect(el);
              if (
                s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                s.backgroundColor !== "transparent"
              )
                closingItems.push({
                  type: "shape",
                  rect: r,
                  background: s.backgroundColor,
                });
              if (el.classList.contains("closing-bullet"))
                closingItems.push({
                  type: "text",
                  text: "•",
                  rect: {
                    ...r,
                    x: r.x - 17,
                    width: 16,
                    height: parseFloat(s.lineHeight),
                  },
                  style: { ...style(el), textAlign: "left" },
                });
            }
            for (const im of closing.querySelectorAll("img"))
              closingItems.push({
                type: "image",
                src: im.src,
                rect: rect(im),
                image: {
                  width: im.naturalWidth,
                  height: im.naturalHeight,
                  fit: getComputedStyle(im).objectFit,
                  position: getComputedStyle(im).objectPosition,
                },
              });
            const walker = document.createTreeWalker(
              closing,
              NodeFilter.SHOW_TEXT,
            );
            let t;
            while ((t = walker.nextNode())) {
              if (!t.textContent?.trim()) continue;
              const range = document.createRange(),
                el = t.parentElement!,
                lines: any[] = [];
              for (let ci = 0; ci < t.textContent.length; ci++) {
                range.setStart(t, ci);
                range.setEnd(t, ci + 1);
                const r = range.getBoundingClientRect();
                if (!r.width) continue;
                let line = lines.at(-1);
                if (!line || Math.abs(line.y - r.y) > 1) {
                  line = {
                    text: "",
                    x: r.x,
                    y: r.y,
                    right: r.right,
                    height: r.height,
                  };
                  lines.push(line);
                }
                line.text += t.textContent[ci];
                line.right = r.right;
              }
              for (const line of lines)
                if (line.text.trim())
                  closingItems.push({
                    type: "text",
                    text: line.text,
                    rect: {
                      x: line.x - base.x,
                      y: line.y - base.y,
                      width: line.right - line.x + 1,
                      height: line.height + 2,
                    },
                    style: { ...style(el), textAlign: "left" },
                    url: el.closest("a")?.href,
                  });
            }
          }
          return {
            rect: rect(node),
            text: text.textContent || "",
            style: style(text),
            closingItems,
            hasClosing: !!closing,
            image: im
              ? {
                  src: im.src,
                  rect: rect(im),
                  width: im.naturalWidth,
                  height: im.naturalHeight,
                  fit: getComputedStyle(im).objectFit,
                  position: getComputedStyle(im).objectPosition,
                }
              : null,
            cells: Array.from(node.querySelectorAll("th,td")).map((c) => {
              const arrow = c.querySelector("svg");
              return {
                text: c.textContent || "",
                rect: rect(c),
                style: style(c),
                rowBackground: getComputedStyle(c.parentElement!)
                  .backgroundColor,
                direction: arrow?.outerHTML,
                directionRect: arrow ? rect(arrow) : undefined,
                directionColor: arrow
                  ? getComputedStyle(arrow).color
                  : undefined,
              };
            }),
            url: node.querySelector("a")?.href,
            svg: node.querySelector("svg")?.outerHTML,
          };
        });
        const entries: any[] = dom.hasClosing
          ? dom.closingItems.map((item: any, n: number) => ({
              id: `p${pi + 1}-${source.id}-${n}`,
              page: pi,
              type: item.type,
              dom: item,
              style: { background: item.background },
            }))
          : [{ ...source, id: `p${pi + 1}-${source.id}`, page: pi, dom }];
        for (const e of entries) {
          const convert = (s: any) => {
            const id = s.fontFamily?.match(/LEE Managed ([a-f0-9-]+)/)?.[1];
            const families = (s.fontFamily ?? "")
              .split(",")
              .map((f: string) => f.trim().replace(/["']/g, ""));
            const face = families
              .map((family: string) =>
                fontFaces.find(
                  (f) =>
                    f.family === family &&
                    f.weight === Number(s.fontWeight) &&
                    f.style === (s.fontStyle ?? "normal"),
                ),
              )
              .find(Boolean);
            const fontName = id ? fontNames[id] : face?.name;
            if (!fontName && (e.type === "text" || e.type === "table"))
              throw Error(`Unresolved native font ${s.fontFamily}`);
            const rgb = (s.color?.match(/[\d.]+/g) || ["0", "0", "0"])
              .slice(0, 3)
              .map(Number);
            return {
              ...s,
              fontName,
              fontSizePt: s.fontSize * 0.75,
              leadingPt: s.lineHeight * 0.75,
              hex:
                "#" +
                rgb
                  .map((n: number) =>
                    Math.round(n).toString(16).padStart(2, "0"),
                  )
                  .join(""),
            };
          };
          if (e.dom.style) e.dom.style = convert(e.dom.style);
          if (e.type === "text")
            e.firstBaseline = baseline(e.dom.rect, e.dom.text);
          if (e.type === "table")
            e.dom.cells = e.dom.cells.map((c: any) => ({
              ...c,
              style: convert(c.style),
              baseline: baseline(c.rect, c.text),
            }));
          if (e.type === "chart" || e.type === "image") {
            let bytes: Buffer, extension: string;
            const src = e.dom.image?.src || e.dom.src;
            if (e.type === "image" && !src) continue;
            if (e.type === "chart" || src?.startsWith("data:image/svg+xml")) {
              const svg =
                e.type === "chart"
                  ? e.dom.svg
                  : Buffer.from(src.split(",")[1], "base64").toString("utf8");
              if (!svg) throw Error(`Missing vector artwork ${e.id}`);
              const graphic = await browser.newPage();
              try {
                await graphic.setContent(
                  `<html><head><style>${css}@page{margin:0}html,body{margin:0;width:${e.dom.rect.width}px;height:${e.dom.rect.height}px}svg{width:100%;height:100%;display:block}</style></head><body>${svg}</body></html>`,
                );
                await graphic.evaluate(() => document.fonts.ready);
                bytes = await graphic.pdf({
                  width: e.dom.rect.width + "px",
                  height: e.dom.rect.height + "px",
                  printBackground: true,
                });
                extension = "pdf";
              } finally {
                await graphic.close();
              }
            } else {
              const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(
                src,
              );
              if (!match) throw Error(`Unfrozen or unsupported image ${e.id}`);
              bytes = Buffer.from(match[2]!, "base64");
              extension = match[1] === "jpeg" ? "jpg" : match[1]!;
              if (extension === "webp") {
                const sharp = (await import("sharp")).default;
                bytes = await sharp(bytes).png().toBuffer();
                extension = "png";
              }
            }
            e.link = `Links/${e.id}.${extension}`;
            await writeFile(path.join(directory, e.link), bytes, {
              flag: "wx",
            });
          }
          // Artwork is already written and hash-pinned as links. Avoid embedding
          // repeated data URLs in the native layout (especially shared logos).
          delete e.src;
          delete e.dom.src;
          delete e.dom.svg;
          delete e.dom.closingItems;
          if (e.dom.image) delete e.dom.image.src;
          model.push(e);
        }
      }
    }
    await geometryPdf.loadingTask.destroy();
    await writeFile(
      path.join(directory, "layout.json"),
      JSON.stringify({
        schemaVersion: 1,
        pages: job.template.pages.filter((p) => !p.hidden).length,
        fonts: nativeFonts,
        elements: model,
      }),
      { flag: "wx" },
    );
    return model;
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
