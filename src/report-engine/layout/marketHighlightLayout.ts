import { getByContextPath, getByPath } from "../../engine/bindings";
import type {
  ImageElement,
  ReportElement,
  ReportPage,
  ShapeElement,
  TextElement,
} from "../../types/report";

/**
 * Content-aware layout for the three Market Highlights property-card
 * sections (Top Availabilities, Top Deliveries, Under Construction).
 *
 * The template authors exactly three card slots per section (see
 * `propertySection` in `src/data/sampleTemplate.ts`), and
 * `buildPresentationModel`'s `presentProperties` pads a short section with
 * trailing `state: "none"` placeholder records so every slot always has
 * *something* bound. That padding is what previously rendered as repeated
 * "None to Report" cards. This module runs once, after page expansion, and
 * turns that governed placeholder state into a deterministic, content-aware
 * layout: unused slots are removed (not hidden), a section with zero
 * records collapses to a compact empty-state strip, and the vertical space
 * reclaimed from empty/undersized sections is redistributed (capped) to the
 * sections that still have cards to show.
 *
 * This is purely a presentation-layer transform. It never queries a data
 * source and never infers business meaning -- it only reads the same
 * `state` sentinel the renderer and QA validator already agree on.
 */

type HighlightCategory = "availability" | "deliveries" | "construction";

const STATIC_EMPTY_STATE_LABEL: Partial<Record<HighlightCategory, string>> = {
  availability: "No Qualifying Availabilities",
  construction: "No Projects Under Construction",
};

/**
 * Deliveries' empty-state label names the actual reporting quarter (e.g.
 * "No Q2 Deliveries") rather than a hardcoded "Q3" -- `data.report.period`
 * is the same `IndustrialMarketReport.report.period` field every other
 * quarter-aware label on the page already reads (e.g. "2026 Q2"), so this
 * derives from the live report instead of guessing or duplicating it.
 */
function emptyStateLabel(category: HighlightCategory, data: unknown): string {
  const staticLabel = STATIC_EMPTY_STATE_LABEL[category];
  if (staticLabel) return staticLabel;
  const period = String(getByPath(data, "report.period") ?? "").trim();
  const quarter = period.match(/Q[1-4]/i)?.[0]?.toUpperCase();
  return `No ${quarter ?? "Current Quarter"} Deliveries`;
}

/** Order sections appear in on the page (top to bottom). */
const CATEGORY_ORDER: HighlightCategory[] = [
  "availability",
  "deliveries",
  "construction",
];

const CARD_SLOTS = 3;
/** Max extra height (px) a populated card row may gain from reclaimed space. */
const MAX_IMAGE_GROWTH = 48;
/** Height (px) of the compact empty-state body strip beneath a section bar. */
const EMPTY_STATE_BODY_HEIGHT = 34;

const NAVY = "#003c50";
const WHITE = "#ffffff";

function categoryFromKey(key: string): HighlightCategory | undefined {
  const bare = key.replace(/^detail-/, "");
  return (CATEGORY_ORDER as string[]).includes(bare)
    ? (bare as HighlightCategory)
    : undefined;
}

interface SlotElements {
  image?: ImageElement;
  caption?: ShapeElement;
  address?: TextElement;
  detail?: TextElement;
}

interface HighlightGroup {
  key: string;
  category: HighlightCategory;
  bar: ShapeElement;
  title: TextElement;
  slots: SlotElements[];
  /** Every non-highlight element on the page, for elements we leave alone. */
}

function findGroups(elements: ReportElement[]): HighlightGroup[] {
  const bars = new Map<string, ShapeElement>();
  const titles = new Map<string, TextElement>();
  const slots = new Map<string, SlotElements[]>();
  for (const element of elements) {
    const barMatch = /^(.*)-bar$/.exec(element.id);
    if (barMatch && element.type === "shape") {
      bars.set(barMatch[1]!, element);
      continue;
    }
    const titleMatch = /^(.*)-section-title$/.exec(element.id);
    if (titleMatch && element.type === "text") {
      titles.set(titleMatch[1]!, element);
      continue;
    }
    const imageMatch = /^(.*)-image-(\d+)$/.exec(element.id);
    if (imageMatch && element.type === "image") {
      const key = imageMatch[1]!;
      const index = Number(imageMatch[2]);
      const arr = slots.get(key) ?? [];
      arr[index] = { ...arr[index], image: element };
      slots.set(key, arr);
      continue;
    }
    const captionMatch = /^(.*)-caption-(\d+)$/.exec(element.id);
    if (captionMatch && element.type === "shape") {
      const key = captionMatch[1]!;
      const index = Number(captionMatch[2]);
      const arr = slots.get(key) ?? [];
      arr[index] = { ...arr[index], caption: element };
      slots.set(key, arr);
      continue;
    }
    const addressMatch = /^(.*)-text-(\d+)$/.exec(element.id);
    if (addressMatch && element.type === "text") {
      const key = addressMatch[1]!;
      const index = Number(addressMatch[2]);
      const arr = slots.get(key) ?? [];
      arr[index] = { ...arr[index], address: element };
      slots.set(key, arr);
      continue;
    }
    const detailMatch = /^(.*)-detail-(\d+)$/.exec(element.id);
    if (detailMatch && element.type === "text") {
      const key = detailMatch[1]!;
      const index = Number(detailMatch[2]);
      const arr = slots.get(key) ?? [];
      arr[index] = { ...arr[index], detail: element };
      slots.set(key, arr);
    }
  }
  const groups: HighlightGroup[] = [];
  for (const [key, bar] of bars) {
    const title = titles.get(key);
    const groupSlots = slots.get(key);
    const category = categoryFromKey(key);
    if (!title || !groupSlots || !category) continue;
    if (!groupSlots[0]?.image || !groupSlots[0]?.caption) continue;
    groups.push({ key, category, bar, title, slots: groupSlots });
  }
  return groups.sort((a, b) => a.bar.y - b.bar.y);
}

function cardState(
  data: unknown,
  element: TextElement | ImageElement | undefined,
): unknown {
  if (!element?.binding) return undefined;
  const statePath = element.binding.path.replace(
    /\.(address|detail|image)$/,
    ".state",
  );
  return getByContextPath(data, statePath, element.bindingContext);
}

function populatedCount(group: HighlightGroup, data: unknown): number {
  let count = 0;
  for (let index = 0; index < CARD_SLOTS; index += 1) {
    const slot = group.slots[index];
    const state = cardState(data, slot?.address ?? slot?.image);
    if (slot && state !== "none" && state !== undefined) count += 1;
  }
  return count;
}

/** x/width for each populated card, left to right, given the section's bar geometry. */
function cardGeometry(
  count: number,
  xBase: number,
  totalWidth: number,
  gap: number,
  baselineWidths: number[],
): { x: number; width: number }[] {
  if (count <= 0) return [];
  if (count >= 3) {
    let x = xBase;
    return baselineWidths.slice(0, 3).map((width) => {
      const cell = { x, width };
      x += width + gap;
      return cell;
    });
  }
  if (count === 2) {
    const width = Math.floor((totalWidth - gap) / 2);
    const secondWidth = totalWidth - gap - width;
    return [
      { x: xBase, width },
      { x: xBase + width + gap, width: secondWidth },
    ];
  }
  // count === 1: an intentional wider single card, not a full-bleed image.
  const width = Math.min(totalWidth, baselineWidths[0]! * 2 + gap);
  const x = xBase + Math.round((totalWidth - width) / 2);
  return [{ x, width }];
}

function emptyStateElements(
  group: HighlightGroup,
  y: number,
  data: unknown,
): ReportElement[] {
  const label = emptyStateLabel(group.category, data);
  const bg: ShapeElement = {
    id: `${group.key}-empty-state-bg`,
    type: "shape",
    name: "Empty State",
    x: group.bar.x,
    y,
    width: group.bar.width,
    height: EMPTY_STATE_BODY_HEIGHT,
    style: { background: NAVY, opacity: 1 },
  };
  const label_: TextElement = {
    id: `${group.key}-empty-state-text`,
    type: "text",
    name: "Empty State Label",
    x: group.bar.x,
    y: y + EMPTY_STATE_BODY_HEIGHT / 2 - 8,
    width: group.bar.width,
    height: 16,
    text: label,
    style: {
      fontFamily: "Nunito Sans, Arial, sans-serif",
      fontSize: 9,
      fontWeight: 700,
      color: WHITE,
      textAlign: "center",
      opacity: 1,
    },
  };
  return [bg, label_];
}

function layoutGroup(
  group: HighlightGroup,
  count: number,
  newY: number,
  imageGrowth: number,
  data: unknown,
): ReportElement[] {
  const bar: ShapeElement = { ...group.bar, y: newY };
  const title: TextElement = {
    ...group.title,
    y: newY + (group.title.y - group.bar.y),
  };
  // Cards (or the empty-state strip) are collected here and the beveled bar
  // + title are appended AFTER them, below -- later array entries paint on
  // top in this renderer, so the bar/title must always render last to sit
  // above every property image, never behind one.
  const out: ReportElement[] = [];
  if (count === 0) {
    out.push(...emptyStateElements(group, newY + bar.height, data));
    return [...out, bar, title];
  }
  const baseline = group.slots.slice(0, 3).map((slot) => slot.image!);
  const baselineWidths = baseline.map((image) => image.width);
  const gap =
    baseline.length > 1 ? baseline[1]!.x - (baseline[0]!.x + baseline[0]!.width) : 18;
  const geometry = cardGeometry(
    count,
    group.bar.x,
    group.bar.width,
    gap,
    baselineWidths,
  );
  const imageHeight = baseline[0]!.height + imageGrowth;
  const imageY = newY + bar.height;
  const first = group.slots[0]!;
  const insetX = first.address ? first.address.x - first.image!.x : 7;
  const insetWidthDelta = first.address
    ? first.image!.width - first.address.width
    : 14;
  const addressYOffset = first.address ? first.address.y - first.image!.y : first.image!.height + 6;
  const detailYOffset = first.detail ? first.detail.y - first.image!.y : first.image!.height + 24;
  const captionHeight = first.caption!.height;

  for (let index = 0; index < count; index += 1) {
    const slot = group.slots[index];
    const cell = geometry[index]!;
    if (!slot?.image || !slot.caption) continue;
    out.push({
      ...slot.image,
      x: cell.x,
      y: imageY,
      width: cell.width,
      height: imageHeight,
    });
    out.push({
      ...slot.caption,
      x: cell.x,
      y: imageY + imageHeight,
      width: cell.width,
      height: captionHeight,
    });
    if (slot.address)
      out.push({
        ...slot.address,
        x: cell.x + insetX,
        y: imageY + addressYOffset + imageGrowth,
        width: cell.width - insetWidthDelta,
      });
    if (slot.detail)
      out.push({
        ...slot.detail,
        x: cell.x + insetX,
        y: imageY + detailYOffset + imageGrowth,
        width: cell.width - insetWidthDelta,
      });
  }
  return [...out, bar, title];
}

/**
 * Reflows one page's Market Highlights sections. No-op for any page that
 * doesn't have exactly the three governed sections (availability, delivery,
 * under-construction) -- e.g. the Market Overview page's Top Sales table is
 * untouched.
 */
function layoutPage(page: ReportPage, data: unknown): ReportPage {
  const groups = findGroups(page.elements);
  const byCategory = new Map(groups.map((group) => [group.category, group]));
  if (CATEGORY_ORDER.some((category) => !byCategory.has(category)))
    return page;
  const ordered = CATEGORY_ORDER.map((category) => byCategory.get(category)!);
  const counts = ordered.map((group) => populatedCount(group, data));
  const populatedHeight =
    ordered[0]!.bar.height + ordered[0]!.slots[0]!.image!.height + ordered[0]!.slots[0]!.caption!.height;
  const compactHeight = ordered[0]!.bar.height + EMPTY_STATE_BODY_HEIGHT;
  const minHeights = counts.map((count) =>
    count === 0 ? compactHeight : populatedHeight,
  );
  const groupBottom = (group: HighlightGroup) =>
    group.bar.y +
    group.bar.height +
    group.slots[0]!.image!.height +
    group.slots[0]!.caption!.height;
  const totalTop = ordered[0]!.bar.y;
  const totalBottom = groupBottom(ordered[2]!);
  const gap1 = ordered[1]!.bar.y - groupBottom(ordered[0]!);
  const gap2 = ordered[2]!.bar.y - groupBottom(ordered[1]!);
  const totalSpan = totalBottom - totalTop;
  const sumMin = minHeights.reduce((a, b) => a + b, 0);
  const reclaimed = Math.max(0, totalSpan - gap1 - gap2 - sumMin);
  const populatedIdx = counts
    .map((count, index) => (count > 0 ? index : -1))
    .filter((index) => index >= 0);
  const capacity = MAX_IMAGE_GROWTH * populatedIdx.length;
  const growthPool = Math.min(reclaimed, capacity);
  const perGroupGrowth = populatedIdx.length ? growthPool / populatedIdx.length : 0;

  const finalHeights = minHeights.map((height, index) =>
    counts[index]! > 0 ? height + perGroupGrowth : height,
  );
  const y0 = totalTop;
  const y1 = y0 + finalHeights[0]! + gap1;
  const y2 = y1 + finalHeights[1]! + gap2;
  const ys = [y0, y1, y2];

  const highlightIds = new Set<string>();
  for (const group of groups) {
    highlightIds.add(group.bar.id);
    highlightIds.add(group.title.id);
    for (const slot of group.slots) {
      if (slot.image) highlightIds.add(slot.image.id);
      if (slot.caption) highlightIds.add(slot.caption.id);
      if (slot.address) highlightIds.add(slot.address.id);
      if (slot.detail) highlightIds.add(slot.detail.id);
    }
  }
  const untouched = page.elements.filter((el) => !highlightIds.has(el.id));
  const rebuilt = ordered.flatMap((group, index) =>
    layoutGroup(
      group,
      counts[index]!,
      ys[index]!,
      counts[index]! > 0 ? perGroupGrowth : 0,
      data,
    ),
  );
  return { ...page, elements: [...untouched, ...rebuilt] };
}

export function applyMarketHighlightLayout(
  pages: ReportPage[],
  data: unknown,
): ReportPage[] {
  return pages.map((page) => layoutPage(page, data));
}
