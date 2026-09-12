/**
 * Strips or rejects internal workflow language before an entity (a tenant,
 * buyer, developer, sponsor, or property label) can enter narrative context.
 *
 * This runs in addition to, not instead of, Salesforce-ID stripping
 * (see salesforceIds.ts). If a value cannot be made publication-safe with
 * confidence, this returns an empty string so the caller omits the entity
 * rather than guessing at a corrected name.
 */

// Whole-value matches: the entire field is an internal placeholder, not a
// real entity name wearing a suffix.
const INTERNAL_PLACEHOLDER_VALUES = [
  /^\s*tbd\s*$/i,
  /^\s*n\/?a\s*$/i,
  /^\s*unknown\s*$/i,
  /^\s*pending\s*$/i,
  /^\s*none\s*$/i,
  /^\s*test\s*$/i,
];

// Phrases anywhere in the value that mark it as an internal note rather than
// a publication-safe entity, regardless of what else is in the string.
const INTERNAL_NOTE_PHRASES = [
  /waiting\s+for\s+comp/i,
  /need\s+comp/i,
  /comp\s+needed/i,
  /pending\s+comp/i,
  /internal\s+note/i,
  /analyst\s+note/i,
  /do\s+not\s+publish/i,
  /not\s+for\s+publication/i,
  /workflow\s+stage/i,
  /needs?\s+review/i,
  /follow\s*[- ]?up\s+needed/i,
  /confirm(?:ed)?\s+tenant/i,
  /placeholder/i,
];

// A trailing CRM "scratch" suffix on an otherwise legitimate name, e.g.
// "Acme Logistics - waiting for comp" or "Acme Logistics (TBD)".
const SCRATCH_SUFFIX = new RegExp(
  `[\\s]*[-–—|(:]+\\s*(?:${[
    "waiting for comp",
    "need comp",
    "comp needed",
    "pending comp",
    "internal note",
    "analyst note",
    "tbd",
    "do not publish",
    "not for publication",
    "workflow stage",
    "needs review",
  ]
    .map((phrase) => phrase.replace(/ /g, "\\s+"))
    .join("|")})\\)?\\s*$`,
  "i",
);

/**
 * Returns a publication-safe version of an entity string, or "" when the
 * value cannot be trusted for publication.
 */
export function sanitizePublicationEntity(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (INTERNAL_PLACEHOLDER_VALUES.some((pattern) => pattern.test(trimmed)))
    return "";

  // Try stripping a trailing CRM scratch suffix first: "Acme Logistics -
  // waiting for comp" is a real name wearing a bad suffix, not itself an
  // internal note, even though the note phrase appears inside the string.
  const stripped = trimmed.replace(SCRATCH_SUFFIX, "").trim();
  if (stripped && stripped.length >= 2 && stripped !== trimmed) return stripped;

  if (INTERNAL_NOTE_PHRASES.some((pattern) => pattern.test(trimmed))) return "";
  if (!stripped || stripped.length < 2) return "";
  return trimmed;
}
