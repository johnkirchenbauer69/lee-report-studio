import type { SalesforceClient } from "./SalesforceClient.ts";
import type { FileSystemAssetStore } from "../../assets/assetStore.ts";
import type { SalesforceImageIndex } from "../../assets/salesforceImageIndex.ts";
import { isSalesforceAttachmentOrFileId } from "./salesforceIds.ts";
import {
  MAX_REPORT_IMAGE_SOURCE_BYTES,
  normalizeOversizedReportImage,
  ReportImageNormalizationError,
} from "../../assets/reportImageNormalizer.ts";

const ATTACHMENT_PREFIX = "00P";
export const MAX_DIRECT_REPORT_IMAGE_BYTES = 15 * 1024 * 1024;
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
  /** Sanitized provenance note retained with the generated report. */
  diagnostic?: string;
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
    response = await deps.client.getBinary(sobjectPathFor(id), {
      maxBytes: MAX_REPORT_IMAGE_SOURCE_BYTES,
    });
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
  if (buffer.length > MAX_DIRECT_REPORT_IMAGE_BYTES) {
    try {
      const normalized = await normalizeOversizedReportImage({
        buffer,
        mimeType: contentType,
      });
      const asset = await deps.assetStore.importBuffer({
        buffer: normalized.buffer,
        mimeType: normalized.mimeType,
        name: `salesforce-${id}-normalized.jpg`,
        derivative: normalized.derivative,
      });
      await deps.index.set(id, asset.id);
      return {
        url: asset.source,
        diagnostic: `Oversized Salesforce property image was normalized into an immutable Studio JPEG derivative (${normalized.derivative.originalWidth}x${normalized.derivative.originalHeight}, ${Math.round((normalized.derivative.sourceSize / (1024 * 1024)) * 10) / 10} MB source; ${normalized.derivative.outputWidth}x${normalized.derivative.outputHeight}, ${Math.round(normalized.derivative.outputSize / 1024)} KB output).`,
      };
    } catch (error) {
      const category =
        error instanceof ReportImageNormalizationError
          ? error.code.toLowerCase().replaceAll("_", " ")
          : "normalization failed";
      return {
        warning: `Salesforce attachment ${id} could not be normalized for report use (${category}).`,
      };
    }
  }

  const asset = await deps.assetStore.importBuffer({
    buffer,
    mimeType: contentType,
    name: `salesforce-${id}`,
  });
  await deps.index.set(id, asset.id);
  return { url: asset.source };
}
