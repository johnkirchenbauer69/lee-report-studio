const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export const looksLikeSalesforceId = (value?: unknown): boolean =>
  typeof value === "string" && SALESFORCE_ID.test(value.trim());

export const containsSalesforceIdToken = (value?: unknown): boolean =>
  typeof value === "string" &&
  value
    .split(/[^a-zA-Z0-9]+/)
    .some((token) => looksLikeSalesforceId(token));

export const sanitizeSalesforceDisplayValue = (value?: unknown): string => {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).trim();
  return !trimmed || looksLikeSalesforceId(trimmed) ? "" : trimmed;
};

const FILE_PREFIXES = new Set(["00P", "068", "069"]);
export const isSalesforceAttachmentOrFileId = (value: string): boolean =>
  looksLikeSalesforceId(value) && FILE_PREFIXES.has(value.trim().slice(0, 3));
