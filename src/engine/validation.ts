import type { ReportPage, ValidationItem } from "../types/report";
import { getByContextPath } from "./bindings";
import { elementRect, getRotatedAabb } from "./geometry";

/**
 * Card-repeater bindings (property/project highlight slots such as
 * `market.topConstruction[0].image`) carry a sibling `.state` field written
 * by `buildPresentationModel`'s `presentProperties` helper:
 *   - "record": a real qualifying record — all normal checks apply.
 *   - "image-unavailable": a real record whose image genuinely could not be
 *     resolved — the "missing an image" check must still fire.
 *   - "none": a padding slot for a repeater index beyond the governed
 *     record count (including the entire section when there are zero
 *     qualifying records, i.e. a legitimate "None to Report" state) — no
 *     field on this slot should ever generate a QA warning.
 * This mirrors the lookup CanvasElement.tsx already performs to render the
 * "None to Report" placeholder, so QA and rendering agree on the same
 * canonical section/slot state instead of re-deriving it independently.
 */
const CARD_FIELD_BINDING = /\.(address|detail|image)$/;

function resolveCardState(
  data: unknown,
  binding: { path: string } | undefined,
  bindingContext: { name: string; path: string } | undefined,
): unknown {
  if (!binding || !CARD_FIELD_BINDING.test(binding.path)) return undefined;
  const statePath = binding.path.replace(CARD_FIELD_BINDING, ".state");
  return getByContextPath(data, statePath, bindingContext);
}

export function validatePage(
  page: ReportPage,
  data: unknown,
): ValidationItem[] {
  const items: ValidationItem[] = [];
  let resolved = 0;

  page.elements.forEach((el) => {
    if (el.width <= 0 || el.height <= 0)
      items.push({
        level: "error",
        message: `${el.name} has an invalid size`,
        elementId: el.id,
      });
    // Page-repeat bindings (for example a submarket detail page's
    // `submarket.topAvailabilities[0].image`) have no concrete context to
    // resolve against until expandTemplatePages runs per submarket — this
    // mirrors prepareTemplate.ts's identical `deferredPageBinding` guard.
    // Validating them here against the un-expanded template would produce
    // meaningless false positives, not a real data gap.
    const deferredPageBinding = Boolean(
      page.repeat &&
        el.binding?.path.startsWith(`${page.repeat.contextName}.`),
    );
    const cardState = deferredPageBinding
      ? undefined
      : resolveCardState(data, el.binding, el.bindingContext);
    const isNoneToReportSlot = cardState === "none";
    if (el.binding && !deferredPageBinding) {
      const value = getByContextPath(data, el.binding.path, el.bindingContext);
      if (isNoneToReportSlot) {
        // Nonexistent repeater slot (zero qualifying records, or an index
        // past the actual record count) — a resolved, valid absence, not a
        // data gap. Neither warn nor count it as a resolved binding.
      } else if (value == null) {
        items.push({
          level: "warning",
          message: `Missing data: ${el.binding.label ?? el.binding.path}`,
          elementId: el.id,
        });
      } else resolved += 1;
    }
    const bounds = getRotatedAabb(elementRect(el));
    if (
      !el.allowOverflow &&
      (bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.x + bounds.width > page.width ||
        bounds.y + bounds.height > page.height)
    ) {
      items.push({
        level: "warning",
        message: `${el.name} extends beyond the page`,
        elementId: el.id,
      });
    }
    if (el.type === "image" && el.binding && !deferredPageBinding) {
      // Bound images resolve their real src from data at render time; the
      // element's design-time `src` is not meaningful for a bound image, so
      // check the resolved value instead of the stale static field. Skip
      // entirely for a nonexistent ("none") card slot — only a real record
      // (state "record"/"image-unavailable", or no card-state binding at
      // all) with a genuinely unresolved image should warn.
      const value = getByContextPath(data, el.binding.path, el.bindingContext);
      if (!isNoneToReportSlot && !value)
        items.push({
          level: "error",
          message: `${el.name} is missing an image`,
          elementId: el.id,
        });
    } else if (el.type === "image" && !el.src)
      items.push({
        level: "error",
        message: `${el.name} is missing an image`,
        elementId: el.id,
      });
    if (
      el.style.fill?.type === "linear-gradient" &&
      (el.style.fill.stops.length < 2 || el.style.fill.stops.length > 3)
    )
      items.push({
        level: "error",
        message: `${el.name} has an invalid gradient`,
        elementId: el.id,
      });
    if (el.type === "text") {
      const fontSize = el.style.typography?.fontSize ?? el.style.fontSize ?? 14;
      const lineHeight = el.style.typography?.lineHeight ?? 1.2;
      const estimatedCharacters =
        Math.max(1, Math.floor(el.width / (fontSize * 0.55))) *
        Math.max(1, Math.floor(el.height / (fontSize * lineHeight)));
      if (el.text.length > estimatedCharacters * 1.25)
        items.push({
          level: "warning",
          message: `${el.name} may overflow its text box`,
          elementId: el.id,
        });
    }
  });

  items.unshift({
    level: "ok",
    message: `${resolved} bound elements resolved on this page`,
  });
  return items;
}
