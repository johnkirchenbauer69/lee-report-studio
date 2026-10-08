import { z } from "zod";

const item = z
  .object({
    id: z.string().min(1),
    term: z.string(),
    description: z.string(),
    kind: z.enum(["bullet", "paragraph", "footnote"]),
  })
  .strict();
const group = z
  .object({ id: z.string().min(1), heading: z.string(), items: z.array(item) })
  .strict();
const department = z
  .object({
    id: z.string().min(1),
    heading: z.string(),
    columns: z.number().int().min(1).max(4),
  })
  .strict();
const contact = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    title: z.string(),
    email: z
      .string()
      .refine(
        (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        "Enter an email address",
      ),
    department: z.string(),
    displayOrder: z.number().int(),
    isActive: z.boolean(),
  })
  .strict();
const statistic = z
  .object({
    id: z.string().min(1),
    value: z.string(),
    label: z.string(),
    description: z.string(),
  })
  .strict();
const opening = z
  .object({
    id: z.string().min(1),
    year: z.number().int().min(1900).max(2200),
    market: z.string(),
    displayOrder: z.number().int(),
  })
  .strict();

/** Template-owned content: no Salesforce fields, independent published snapshots. */
export const closingContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("sections"),
      variant: z.enum(["methodology", "definitions"]),
      source: z.string(),
      groups: z.array(group),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contacts"),
      source: z.string(),
      departments: z.array(department),
      contacts: z.array(contact),
    })
    .strict(),
  z
    .object({
      kind: z.literal("company"),
      source: z.string(),
      heading: z.string(),
      subheading: z.string(),
      paragraphs: z.array(z.string()),
      emphasis: z.string(),
      growthHeading: z.string(),
      growthCaption: z.string(),
      statistics: z.array(statistic),
      openings: z.array(opening),
      mapAsset: z.string(),
      logoAsset: z.string(),
    })
    .strict(),
]);
export type ClosingContent = z.infer<typeof closingContentSchema>;
export type ReportContact = z.infer<typeof contact>;

export const ordered = <T extends { displayOrder: number; id: string }>(
  items: T[],
) =>
  [...items].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
  );

export function validateClosingContent(content: ClosingContent): string[] {
  const errors: string[] = [];
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length)
      errors.push("Record identifiers must be unique.");
  };
  if (content.kind === "contacts") {
    unique(content.contacts.map((c) => c.id));
    unique(content.departments.map((d) => d.id));
    if (
      content.contacts.some(
        (c) => !content.departments.some((d) => d.id === c.department),
      )
    )
      errors.push("Every contact must belong to an existing department.");
  } else if (content.kind === "sections") {
    unique(content.groups.map((g) => g.id));
    unique(content.groups.flatMap((g) => g.items.map((i) => i.id)));
  } else {
    unique(content.openings.map((o) => o.id));
    unique(content.statistics.map((s) => s.id));
  }
  return errors;
}
