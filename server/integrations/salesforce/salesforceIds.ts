/** Shared server entry point for Salesforce id and display-value safety. */
export {
  containsSalesforceIdToken,
  isSalesforceAttachmentOrFileId,
  looksLikeSalesforceId,
  sanitizeSalesforceDisplayValue,
} from "../../../src/shared/salesforceIds.ts";
