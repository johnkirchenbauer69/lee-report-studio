import type { SalesforceClient } from "./SalesforceClient.ts";
import type { FileSystemAssetStore } from "../../assets/assetStore.ts";
import type { SalesforceImageIndex } from "../../assets/salesforceImageIndex.ts";
import { isSalesforceAttachmentOrFileId } from "./salesforceIds.ts";

const ATTACHMENT_PREFIX = "00P";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPE = /^image\/(png|jpe?g|webp|gif)/i;

export { isSalesforceAttachmentOrFileId } from "./salesforceIds.ts";

const sobjectPathFor = (id: string): string =>
  id.slice(0, 3) === ATTACHMENT_PREFIX
    ? `sobjects/Attachment/${id}/Body`
    : `sobjects/ContentVersion/${id}/VersionData`;

export interface ResolvedSalesforceImage {
  /** A Studio-served `/api/assets/{id}/content` URL, or the original value if unchanged. */
  url?: string;
  /** Set when resolution failed; the caller should surface this as a report warning, never a raw id/URL. */
  warning?: string;
}

/**
 * Resolves a Salesforce contributor/property image field value into a
 * Studio-hosted asset URL. Values that are not recognized Salesforce
 * Attachment/File ids (e.g. already-valid image URLs) pass through
 * unchanged. Never emits a bare Salesforce id as a URL — on any failure it
 * returns a `warning` instead, so callers never turn an id into a broken
 * `<img>` request. Runs entirely server-side; no Salesforce credentials or
 * tokens are ever exposed to the caller.
 */
export async function resolveSalesforceImage(
  value: string | undefined,
  deps: {
    client: SalesforceClient;
    assetStore: Pick<FileSystemAssetStore, "importBuffer">;
    index: SalesforceImageIndex;
  },
): Promise<ResolvedSalesforceImage> {
  if (!value) return {};
  if (!isSalesforceAttachmentOrFileId(value)) return { url: value };
  const id = value.trim();

  const cachedAssetId = await deps.index.get(id);
  if (cachedAssetId) return { url: `/api/assets/${cachedAssetId}/content` };

  if (!deps.client.getBinary)
    return {
      warning: `Salesforce attachment ${id} could not be resolved (the configured Salesforce client does not support binary fetches).`,
    };

  let response;
  try {
    response = await deps.client.getBinary(sobjectPathFor(id));
  } catch (error) {
    return {
      warning: `Salesforce attachment ${id} could not be resolved (${error instanceof Error ? error.message : "request failed"}).`,
    };
  }

  const { buffer, contentType, status } = response;
  if (status < 200 || status >= 300 || !ALLOWED_CONTENT_TYPE.test(contentType))
    return {
      warning: `Salesforce attachment ${id} could not be resolved (received ${contentType || `HTTP ${status}`} instead of an image).`,
    };
  if (buffer.length > MAX_IMAGE_BYTES)
    return {
      warning: `Salesforce attachment ${id} could not be resolved (image exceeds the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB size limit).`,
    };

  const asset = await deps.assetStore.importBuffer({
    buffer,
    mimeType: contentType,
    name: `salesforce-${id}`,
  });
  await deps.index.set(id, asset.id);
  return { url: asset.source };
}
