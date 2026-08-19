import type { ReportPage, ValidationItem } from '../types/report';
import { getByPath } from './bindings';

export function validatePage(page: ReportPage, data: unknown): ValidationItem[] {
  const items: ValidationItem[] = [];
  let resolved = 0;

  page.elements.forEach((el) => {
    if (el.binding) {
      const value = getByPath(data, el.binding.path);
      if (value == null) {
        items.push({ level: 'warning', message: `Missing data: ${el.binding.label ?? el.binding.path}`, elementId: el.id });
      } else resolved += 1;
    }
    if (el.x < 0 || el.y < 0 || el.x + el.width > page.width || el.y + el.height > page.height) {
      items.push({ level: 'warning', message: `${el.name} extends beyond the page`, elementId: el.id });
    }
  });

  items.unshift({ level: 'ok', message: `${resolved} bound elements resolved on this page` });
  return items;
}
