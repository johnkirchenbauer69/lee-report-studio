import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import type {
  Fill,
  ImageElement,
  ReportElement,
  ReportPage,
  ReportTemplate,
  TableElement,
} from "../types/report";
import { formatValue, getByContextPath, getByPath } from "../engine/bindings";
import { resolveTypography } from "../engine/typography";

const POINTS_PER_PIXEL = 72 / 96;
const rotatedBoxOrigin = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
) => {
  const radians = (-rotation * Math.PI) / 180;
  const cosine = Math.cos(radians),
    sine = Math.sin(radians);
  const halfX = width / 2,
    halfY = height / 2;
  return {
    x: x + halfX - (cosine * halfX - sine * halfY),
    y: y + halfY - (sine * halfX + cosine * halfY),
  };
};
/**
 * Given a point's unrotated (px, py) position and the box center it belongs
 * to, returns the anchor pdf-lib needs so that, after rotating around that
 * anchor by `rotation` degrees, the point lands where it would sit on a box
 * rotated about its own center — matching how `rotatedBoxOrigin` positions
 * shape corners.
 */
const rotatedPointOrigin = (
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  rotation: number,
) => {
  const radians = (-rotation * Math.PI) / 180;
  const cosine = Math.cos(radians),
    sine = Math.sin(radians);
  const dx = px - centerX,
    dy = py - centerY;
  return {
    x: centerX + (cosine * dx - sine * dy),
    y: centerY + (sine * dx + cosine * dy),
  };
};
const color = (value: string | undefined) => {
  const normalized = (value ?? "#000000").replace("#", "");
  if (normalized === "transparent" || normalized.length < 6)
    return rgb(0, 0, 0);
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => character.repeat(2))
          .join("")
      : normalized;
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
};
const pdfSafe = (value: string) =>
  value
    .replace(/▼/g, "v")
    .replace(/▲/g, "^")
    .replace(/[–—]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const interpolateColor = (a: string, b: string, t: number) => {
  const from = a.replace("#", ""),
    to = b.replace("#", "");
  return `#${[0, 2, 4]
    .map((index) =>
      lerp(
        parseInt(from.slice(index, index + 2), 16),
        parseInt(to.slice(index, index + 2), 16),
        t,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

function drawFill(
  page: PDFPage,
  reportPage: ReportPage,
  element: ReportElement,
  fill: Fill | undefined,
) {
  const x = element.x * POINTS_PER_PIXEL,
    y = (reportPage.height - element.y - element.height) * POINTS_PER_PIXEL,
    width = element.width * POINTS_PER_PIXEL,
    height = element.height * POINTS_PER_PIXEL,
    opacity = element.style.opacity ?? 1;
  if (!fill || fill.type === "solid") {
    const origin = rotatedBoxOrigin(x, y, width, height, element.rotation ?? 0);
    page.drawRectangle({
      ...origin,
      width,
      height,
      color: color(
        fill?.type === "solid" ? fill.color : element.style.background,
      ),
      opacity,
      rotate: degrees(-(element.rotation ?? 0)),
    });
    return;
  }
  const stops = [...fill.stops].sort((a, b) => a.position - b.position);
  const slices = 48;
  for (let index = 0; index < slices; index++) {
    const t = index / (slices - 1),
      position = t * 100;
    let left = stops[0],
      right = stops.at(-1)!;
    for (let stop = 0; stop < stops.length - 1; stop++)
      if (
        position >= stops[stop].position &&
        position <= stops[stop + 1].position
      ) {
        left = stops[stop];
        right = stops[stop + 1];
        break;
      }
    const local =
        (position - left.position) /
        Math.max(1, right.position - left.position),
      shade = interpolateColor(
        left.color,
        right.color,
        Math.max(0, Math.min(1, local)),
      );
    const vertical = Math.abs(Math.sin((fill.angle * Math.PI) / 180)) > 0.7;
    page.drawRectangle(
      vertical
        ? {
            x,
            y: y + height * t,
            width,
            height: height / slices + 1,
            color: color(shade),
            opacity,
          }
        : {
            x: x + width * t,
            y,
            width: width / slices + 1,
            height,
            color: color(shade),
            opacity,
          },
    );
  }
}

function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
) {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

async function croppedPng(
  element: ImageElement,
  resolvedSource = element.src,
): Promise<Uint8Array> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = resolvedSource;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(
        new Error(`Image ${element.name} could not be loaded for PDF export.`),
      );
  });
  const width = Math.max(1, Math.min(2000, Math.round(element.width * 2))),
    height = Math.max(1, Math.min(2000, Math.round(element.height * 2))),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  if (element.sourceCrop) {
    const region = element.sourceCrop;
    context.drawImage(
      image,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      width,
      height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Image conversion failed.")),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }
  const fit = element.fit ?? "cover",
    crop = element.crop ?? { x: 50, y: 50, zoom: 1 };
  let drawWidth = width,
    drawHeight = height;
  if (fit === "contain") {
    const scale = Math.min(
      width / image.naturalWidth,
      height / image.naturalHeight,
    );
    drawWidth = image.naturalWidth * scale;
    drawHeight = image.naturalHeight * scale;
  } else if (fit === "cover") {
    const scale =
      Math.max(width / image.naturalWidth, height / image.naturalHeight) *
      crop.zoom;
    drawWidth = image.naturalWidth * scale;
    drawHeight = image.naturalHeight * scale;
  } else if (fit === "original") {
    drawWidth = image.naturalWidth * crop.zoom;
    drawHeight = image.naturalHeight * crop.zoom;
  }
  const x = (width - drawWidth) * (crop.x / 100),
    y = (height - drawHeight) * (crop.y / 100);
  context.drawImage(image, x, y, drawWidth, drawHeight);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Image conversion failed.")),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function drawTable(
  pdfPage: PDFPage,
  reportPage: ReportPage,
  element: TableElement,
  data: unknown,
  fonts: { regular: PDFFont; bold: PDFFont },
) {
  const rows = getByContextPath(
      data,
      element.sourcePath,
      element.bindingContext,
    ),
    items = Array.isArray(rows)
      ? rows.slice(0, element.maxRows ?? rows.length)
      : [],
    x = element.x * POINTS_PER_PIXEL,
    y = (reportPage.height - element.y - element.height) * POINTS_PER_PIXEL,
    width = element.width * POINTS_PER_PIXEL,
    height = element.height * POINTS_PER_PIXEL,
    rowHeight = height / (items.length + 1),
    weights = element.columns.map((column) => column.width ?? 1),
    weightTotal = weights.reduce((sum, value) => sum + value, 0),
    fontSize =
      (element.variant === "market-matrix" ? 5.6 : 7) * POINTS_PER_PIXEL;
  let cursor = x;
  pdfPage.drawRectangle({
    x,
    y: y + height - rowHeight,
    width,
    height: rowHeight,
    color: color(element.variant === "market-matrix" ? "#003c50" : "#c4123f"),
  });
  element.columns.forEach((column, index) => {
    const columnWidth = (width * weights[index]) / weightTotal,
      lines = column.label.split("\n");
    lines.slice(0, 3).forEach((line, lineIndex) =>
      pdfPage.drawText(line, {
        x: cursor + 3,
        y: y + height - fontSize - 3 - lineIndex * (fontSize + 1),
        size: fontSize,
        font: fonts.bold,
        color: rgb(1, 1, 1),
        maxWidth: columnWidth - 5,
      }),
    );
    cursor += columnWidth;
  });
  items.forEach((row, rowIndex) => {
    const kind = element.rowKindPath
      ? String(getByPath(row, element.rowKindPath))
      : "";
    const fill =
        kind === "total"
          ? "#8f9194"
          : kind === "minimum" || kind === "maximum"
            ? "#003c50"
            : rowIndex % 2 === 0
              ? "#d4d6d7"
              : "#ffffff",
      ink =
        kind === "total" || kind === "minimum" || kind === "maximum"
          ? "#ffffff"
          : "#142b3a",
      font = kind === "total" ? fonts.bold : fonts.regular;
    const rowY = y + height - (rowIndex + 2) * rowHeight;
    pdfPage.drawRectangle({
      x,
      y: rowY,
      width,
      height: rowHeight,
      color: color(fill),
    });
    let columnX = x;
    element.columns.forEach((column, columnIndex) => {
      const columnWidth = (width * weights[columnIndex]) / weightTotal,
        value = formatValue(getByPath(row, column.path), {
          path: column.path,
          format: column.format,
          decimals: column.decimals ?? 1,
        }),
        lines = wrapText(value, font, fontSize, columnWidth - 6);
      lines.slice(0, 2).forEach((line, lineIndex) =>
        pdfPage.drawText(line, {
          x: columnX + 3,
          y: rowY + rowHeight - fontSize - 3 - lineIndex * (fontSize + 1),
          size: fontSize,
          font,
          color: color(ink),
          maxWidth: columnWidth - 6,
        }),
      );
      columnX += columnWidth;
    });
  });
}

async function drawElement(
  pdf: PDFDocument,
  pdfPage: PDFPage,
  reportPage: ReportPage,
  element: ReportElement,
  data: unknown,
  fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont },
) {
  if (element.hidden) return;
  const x = element.x * POINTS_PER_PIXEL,
    y = (reportPage.height - element.y - element.height) * POINTS_PER_PIXEL,
    width = element.width * POINTS_PER_PIXEL,
    height = element.height * POINTS_PER_PIXEL,
    opacity = element.style.opacity ?? 1,
    rotation = degrees(-(element.rotation ?? 0)),
    origin = rotatedBoxOrigin(x, y, width, height, element.rotation ?? 0);
  if (element.type === "shape") {
    if (element.shape === "circle")
      pdfPage.drawEllipse({
        x: x + width / 2,
        y: y + height / 2,
        xScale: width / 2,
        yScale: height / 2,
        color: color(element.style.background),
        opacity,
        rotate: rotation,
      });
    else drawFill(pdfPage, reportPage, element, element.style.fill);
    const stroke = element.style.stroke;
    if (stroke?.enabled)
      pdfPage.drawRectangle({
        ...origin,
        width,
        height,
        borderColor: color(stroke.color),
        borderWidth: stroke.width * POINTS_PER_PIXEL,
        borderOpacity: stroke.opacity,
        opacity: 0,
        rotate: rotation,
      });
    return;
  }
  if (element.type === "text") {
    const typography = resolveTypography(element.style),
      value = element.binding
        ? formatValue(
            getByContextPath(
              data,
              element.binding.path,
              element.bindingContext,
            ),
            element.binding,
          )
        : element.text,
      font = typography.italic
        ? fonts.italic
        : Number(typography.fontWeight) >= 600
          ? fonts.bold
          : fonts.regular,
      size = typography.fontSize * POINTS_PER_PIXEL,
      lineHeight = size * typography.lineHeight,
      lines = wrapText(
        typography.uppercase ? value.toUpperCase() : value,
        font,
        size,
        width,
      ),
      visibleLines = lines.slice(
        0,
        Math.max(1, Math.floor(height / lineHeight)),
      ),
      blockHeight = visibleLines.length * lineHeight,
      firstBaseline =
        typography.verticalAlign === "middle"
          ? y + (height + blockHeight) / 2 - size
          : typography.verticalAlign === "bottom"
            ? y + blockHeight - size
            : y + height - size;
    const centerX = x + width / 2,
      centerY = y + height / 2;
    visibleLines.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size),
        lineX =
          typography.textAlign === "center"
            ? x + (width - lineWidth) / 2
            : typography.textAlign === "right"
              ? x + width - lineWidth
              : x,
        baselineY = firstBaseline - index * lineHeight,
        anchor = rotatedPointOrigin(
          lineX,
          baselineY,
          centerX,
          centerY,
          element.rotation ?? 0,
        );
        pdfPage.drawText(line, {
          x: anchor.x,
          y: anchor.y,
          size,
          font,
          color: color(typography.color),
          opacity,
          rotate: rotation,
          maxWidth: width,
        });
    });
    return;
  }
  if (element.type === "image" && element.src) {
    try {
      if (typeof Image === "undefined")
        throw new Error("Browser image rendering unavailable");
      const dynamicSource = element.binding
        ? getByContextPath(data, element.binding.path, element.bindingContext)
        : undefined;
      const resolvedSource =
        typeof dynamicSource === "string" ? dynamicSource : element.src;
      const embedded = await pdf.embedPng(
        await croppedPng(element, resolvedSource),
      );
      pdfPage.drawImage(embedded, {
        ...origin,
        width,
        height,
        opacity,
        rotate: rotation,
      });
    } catch (error) {
      if (typeof Image !== "undefined") console.warn(error);
      pdfPage.drawRectangle({
        x,
        y,
        width,
        height,
        color: rgb(0.92, 0.94, 0.96),
      });
      pdfPage.drawText("Image unavailable", {
        x: x + 8,
        y: y + height / 2,
        size: 9,
        font: fonts.regular,
        color: rgb(0.4, 0.45, 0.52),
      });
    }
    return;
  }
  if (element.type === "table") {
    drawTable(pdfPage, reportPage, element, data, fonts);
    return;
  }
  if (element.type === "chart") {
    pdfPage.drawRectangle({
      x,
      y,
      width,
      height,
      borderColor: rgb(0.85, 0.87, 0.9),
      borderWidth: 0.75,
    });
    pdfPage.drawText(element.title ?? "Chart", {
      x: x + 10,
      y: y + height - 16,
      size: 10,
      font: fonts.bold,
      color: rgb(0.12, 0.16, 0.22),
    });
  }
}

export async function createReportPdfBytes(
  template: ReportTemplate,
  data: unknown,
) {
  if ((template.assets ?? []).some((asset) => asset.type === "font"))
    throw new Error(
      "Managed-font reports require the Chromium PDF renderer so editor and PDF typography remain identical.",
    );
  const rotatedComplex = template.pages
    .flatMap((page) => page.elements)
    .find(
      (element) =>
        (element.type === "table" || element.type === "chart") &&
        (element.rotation ?? 0) !== 0,
    );
  if (rotatedComplex)
    throw new Error(
      `Rotated ${rotatedComplex.type} elements require the Chromium PDF renderer.`,
    );
  const pdf = await PDFDocument.create();
  pdf.setTitle(template.name);
  pdf.setCreator("LEE Report Studio");
  pdf.setProducer("LEE Report Studio deterministic renderer");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  for (const reportPage of template.pages.filter((page) => !page.hidden)) {
    const page = pdf.addPage([
      reportPage.width * POINTS_PER_PIXEL,
      reportPage.height * POINTS_PER_PIXEL,
    ]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: reportPage.width * POINTS_PER_PIXEL,
      height: reportPage.height * POINTS_PER_PIXEL,
      color: color(reportPage.background),
    });
    for (const element of reportPage.elements)
      await drawElement(pdf, page, reportPage, element, data, fonts);
  }
  return pdf.save({
    useObjectStreams: false,
    addDefaultPage: false,
    objectsPerTick: 25,
  });
}

export async function exportReportPdf(
  template: ReportTemplate,
  data: unknown,
  fileName = "lee-report.pdf",
) {
  const bytes = await createReportPdfBytes(template, data);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
