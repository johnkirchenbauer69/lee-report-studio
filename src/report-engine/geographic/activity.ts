import type { z } from "zod";
import type { submarketDetailSchema } from "../schema/industrialMarketReport";

type Detail = z.infer<typeof submarketDetailSchema>;
export const ACTIVITY_SECTIONS = [
  { key: "leasing", code: "L", title: "Leases", color: "#762c40" },
  { key: "sales", code: "S", title: "Sales", color: "#762c40" },
  { key: "availabilities", code: "A", title: "Availabilities", color: "#344e68" },
  { key: "construction", code: "U", title: "Under construction", color: "#546d64" },
  { key: "deliveries", code: "D", title: "Deliveries", color: "#546d64" },
] as const;

/** Map and sidebar consume the same frozen, already-ranked entries. No spatial selection. */
export function activitySections(detail: Detail) {
  return ACTIVITY_SECTIONS.map(section => ({ ...section,
    entries: detail[section.key].slice(0, 3).map((record, index) => ({
      code: `${section.code}${index + 1}`, record,
      coordinateStatus: !record.location || record.location.latitude === null || record.location.longitude === null
        ? "missing" as const : "available" as const,
      assignmentMismatch: Boolean(record.location && record.location.assignedSubmarket !== (detail.canonicalName ?? detail.name)),
    })),
  }));
}

export interface MarkerAnchor { code: string; x: number; y: number }
/** Approved prototype's radial callout placement. Anchor points never move. */
export function placeActivityLabels(anchors: MarkerAnchor[], bounds: { left: number; top: number; right: number; bottom: number }) {
  const placed: { code: string; anchor: { x: number; y: number }; label: { x: number; y: number } }[] = [];
  for (const anchor of anchors) {
    let selected: { x: number; y: number } | undefined;
    // Original radii first; outer rings handle maximum-density editions.
    for (const radius of [17, 24, 32, 42, 54, 68, 82]) {
      for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4;
        const candidate = { x: anchor.x + radius * Math.cos(angle), y: anchor.y + radius * Math.sin(angle) };
        if (candidate.x > bounds.left && candidate.x < bounds.right && candidate.y > bounds.top && candidate.y < bounds.bottom &&
          placed.every(other => Math.hypot(candidate.x - other.label.x, candidate.y - other.label.y) >= 23)) {
          selected = candidate; break;
        }
      }
      if (selected) break;
    }
    if (!selected) throw new Error(`Marker label overflow: ${anchor.code}`);
    placed.push({ code: anchor.code, anchor: { x: anchor.x, y: anchor.y }, label: selected });
  }
  return placed;
}
