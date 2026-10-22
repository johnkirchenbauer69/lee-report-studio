import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { execFile } from "node:child_process";
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
  // Own the Chromium process explicitly so failures retain process evidence,
  // independent of the caller's browser/test-runner lifecycle.
  let stage = "launch", pageNumber = 0;
  const appendDiagnostic = (file: string, bytes: string | Buffer) => {
    // Logging must never prevent browser cleanup when the disk itself fails.
    try { appendFileSync(path.join(directory, file), bytes); }
    catch (error) { console.warn("Native capture diagnostic write failed", String(error)); }
  };
  const diagnostic = (event: string, detail: unknown = {}) => appendDiagnostic(
    "capture-events.jsonl",
    JSON.stringify({ at: new Date().toISOString(), event, page: pageNumber, stage, detail }) + "\n",
  );
  const server = await chromium.launchServer({ headless: true, timeout: 30000 });
  const child = server.process();
  diagnostic("process-start", { pid: child.pid });
  child.stderr?.on("data", (chunk) => appendDiagnostic("chromium-stderr.log", chunk));
  child.on("exit", (code, signal) => diagnostic("process-exit", { code, signal }));
  const browser = await chromium.connect(server.wsEndpoint()).catch(async (error) => {
    diagnostic("connect-error", String(error));
    await server.close().catch(() => undefined);
    throw error;
  });
  browser.on("disconnected", () => diagnostic("browser-disconnected"));
  let sampling = false;
  const sampleMemory = () => {
    diagnostic("worker-memory", process.memoryUsage());
    if (process.platform !== "win32" || sampling || !child.pid) return;
    sampling = true;
    // Include only the owned Chromium process tree, never unrelated browsers.
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${child.pid}); do { $added=$false; foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) {$added=$true} } } while($added); @($all | Where-Object {$ids.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount) | ConvertTo-Json -Compress`],
      { windowsHide: true, timeout: 8000 }, (error, stdout) => {
        sampling = false;
        if (error) diagnostic("chromium-memory", { error: error.message });
        else {
          try { diagnostic("chromium-memory", JSON.parse(stdout || "[]")); }
          catch { diagnostic("chromium-memory", { error: "Invalid process sample" }); }
        }
      });
  };
  sampleMemory();
  const memory = setInterval(sampleMemory, 10000);
  let pageDeadline: ReturnType<typeof setTimeout> | undefined;
  let pageTimedOut = false;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    diagnostic("global-deadline");
    void server.close().catch(() => undefined);
  }, 600000);
  try {
    const page = await browser.newPage({
      viewport: { width: 816, height: 1056 },
    });
    page.on("crash", () => diagnostic("page-crash"));
    page.on("close", () => diagnostic("page-close"));
    page.on("framenavigated", (frame) => diagnostic("navigation", { main: frame === page.mainFrame(), url: frame.url() }));
    page.on("pageerror", (error) => diagnostic("page-error", error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || /vite|reload/i.test(message.text())) diagnostic("console", message.text());
    });
    // Keep the layout media stable while reading PDF baselines and DOM frames,
    // matching the production PDF renderer.
    await page.emulateMedia({ media: "screen" });
    await page.addInitScript("window.__name = (value) => value");
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(url).origin ||
      /^(data:|blob:)/.test(route.request().url())
        ? route.continue()
        : route.abort(),
    );
    const captureUrl = new URL(url);
    captureUrl.searchParams.set("nativeCapture", "1");
    await page.goto(captureUrl.href, { waitUntil: "domcontentloaded", timeout: 60000 });
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
    const model: any[] = [];
    for (const [pi, sourcePage] of job.template.pages
      .filter((p) => !p.hidden)
      .entries()) {
      pageNumber = pi + 1;
      stage = "page-readiness";
      diagnostic("page-start", { id: sourcePage.id, name: sourcePage.name });
      pageDeadline = setTimeout(() => {
        pageTimedOut = true;
        diagnostic("page-deadline");
        void server.close().catch(() => undefined);
      }, 90000);
      const firstElement = model.length;
      progress(`Preparing native page ${pi + 1}: ${sourcePage.name}`);
      await page.evaluate((index) => window.dispatchEvent(new CustomEvent("lee:native-page", { detail: index })), pi);
      await page.waitForFunction((index) =>
        document.querySelector(".print-document")?.getAttribute("data-native-page") === String(index) &&
        document.querySelectorAll("section.print-page").length === 1 &&
        document.fonts.status === "loaded" &&
        Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0), pi, { timeout: 60000 });
      await page.evaluate(() => window.dispatchEvent(new Event("lee:refit-narratives")));
      await page.waitForFunction(() => !document.querySelector('[data-narrative-fit="pending"]'));
      if (await page.locator('[data-narrative-overflow="true"]').count()) throw Error(`Narrative overflow on native page ${pi + 1}`);
      // Measure each fixed-size page independently. The actual text, table
      // content and artwork continue to come from the frozen report and DOM.
      stage = "baseline-pdf";
      const geometryPdf = await getDocumentProxy(new Uint8Array(await page.pdf({ printBackground: true, preferCSSPageSize: true })));
      if (geometryPdf.numPages !== 1) throw Error(`Native page ${pi + 1} did not render as one page`);
      const textItems = (
        await (await geometryPdf.getPage(1)).getTextContent()
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
      const pageLocator = page.locator("section.print-page").first();
      for (const source of sourcePage.elements.filter((e) => !e.hidden)) {
        stage = `element:${source.id}`;
        diagnostic("element-start", { type: source.type });
        const loc = pageLocator.getByTestId(source.id);
        // Read the already-ready frozen DOM directly, without repeating
        // interactive locator visibility/action prechecks after PDF printing.
        const handles = await loc.elementHandles();
        if (!handles.length) continue;
        if (handles.length !== 1) throw Error(`Duplicate native element: ${source.id}`);
        const handle = handles[0]!;
        const dom = await handle.evaluate((element) => {
          const node = element as Element;
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
              borderBottomWidth: parseFloat(s.borderBottomWidth),
              borderBottomColor: s.borderBottomColor,
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
            const paintNodes = [closing, ...closing.querySelectorAll("*")];
            for (const el of paintNodes) {
              const s = getComputedStyle(el),
                r = rect(el);
              if (
                s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                s.backgroundColor !== "transparent"
              )
                closingItems.push({
                  type: "shape",
                  paintOrder: paintNodes.indexOf(el) * 3,
                  rect: r,
                  background: s.backgroundColor,
                });
              if (el.classList.contains("closing-bullet"))
                closingItems.push({
                  type: "text",
                  text: "•",
                  paintOrder: paintNodes.indexOf(el) * 3 + 2,
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
                paintOrder: paintNodes.indexOf(im) * 3 + 1,
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
                    paintOrder: paintNodes.indexOf(el) * 3 + 2,
                    text: line.text,
                    rect: {
                      x: line.x - base.x,
                      y: line.y - base.y,
                      width: line.right - line.x + 1,
                      height: line.height + 2,
                    },
                    style: {
                      ...style(el),
                      textAlign: style(el).textAlign === "justify" && line !== lines.at(-1) ? "justify" : "left",
                    },
                    url: el.closest("a")?.href,
                  });
            }
            closingItems.sort((a, b) => a.paintOrder - b.paintOrder);
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
        await handle.dispose();
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
      await geometryPdf.loadingTask.destroy();
      await writeFile(path.join(directory, `capture-page-${pi + 1}.json`), JSON.stringify({ pageId: sourcePage.id, elements: model.slice(firstElement) }), { flag: "wx" });
      clearTimeout(pageDeadline);
      diagnostic("page-complete", { elements: model.length - firstElement });
    }
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
  } catch (error) {
    diagnostic("capture-error", { message: String(error), stack: error instanceof Error ? error.stack : undefined });
    if (pageTimedOut) throw new Error(`Native page ${pageNumber} exceeded its 90-second deadline at ${stage}. No InDesign execution was started.`, { cause: error });
    if (timedOut) throw new Error("Native artwork preparation exceeded its ten-minute deadline. No InDesign execution was started.", { cause: error });
    throw error;
  } finally {
    clearTimeout(deadline);
    clearTimeout(pageDeadline);
    clearInterval(memory);
    diagnostic("cleanup-requested");
    await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
