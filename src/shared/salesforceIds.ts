const SALESFORCE_ID_SHAPE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const SALESFORCE_ID_TOKEN =
  /(?<![a-zA-Z0-9])[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?(?![a-zA-Z0-9])/g;

const isSalesforceIdCandidate = (value: string) =>
  SALESFORCE_ID_SHAPE.test(value) && /[a-zA-Z]/.test(value) && /\d/.test(value);

export const looksLikeSalesforceId = (value?: unknown): boolean =>
  typeof value === "string" && isSalesforceIdCandidate(value.trim());

export const containsSalesforceIdToken = (value?: unknown): boolean =>
  typeof value === "string" &&
  Array.from(value.matchAll(SALESFORCE_ID_TOKEN)).some((match) =>
    isSalesforceIdCandidate(match[0]),
  );

export const sanitizeSalesforceDisplayValue = (
  value?: unknown,
  replacement = "",
): string => {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  return trimmed
    .replace(SALESFORCE_ID_TOKEN, (token) =>
      isSalesforceIdCandidate(token) ? replacement : token,
    )
    .replace(/\s{2,}/g, " ")
    .trim();
};

/**
 * Sanitizes an entire payload at the browser/API boundary while leaving the
 * authoritative server-side source snapshot untouched.
 */
export function sanitizeSalesforceClientPayload<T>(value: T): T {
  if (typeof value === "string")
    return (
      containsSalesforceIdToken(value)
        ? sanitizeSalesforceDisplayValue(value, "Salesforce record")
        : value
    ) as T;
  if (Array.isArray(value))
    return value.map((item) => sanitizeSalesforceClientPayload(item)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeSalesforceClientPayload(item),
      ]),
    ) as T;
  return value;
}

const FILE_PREFIXES = new Set(["00P", "068", "069"]);
export const isSalesforceAttachmentOrFileId = (value: string): boolean =>
  looksLikeSalesforceId(value) && FILE_PREFIXES.has(value.trim().slice(0, 3));
