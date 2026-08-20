import type { ReportPage, ValidationItem } from "../types/report";
import { getByPath } from "./bindings";
import { elementRect, getRotatedAabb } from "./geometry";

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
    if (el.binding) {
      const value = getByPath(data, el.binding.path);
      if (value == null) {
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
    if (el.type === "image" && !el.src)
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
