import http from "node:http";
import https from "node:https";

import type { SalesforceBinaryResponse } from "./SalesforceClient.ts";

export interface SalesforceBinaryRequest {
  url: string;
  accessToken: string;
}

export type SalesforceBinaryTransport = (
  request: SalesforceBinaryRequest,
) => Promise<SalesforceBinaryResponse>;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

const firstHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/**
 * Fetches Salesforce binary bodies without Node's bundled Fetch/Undici path.
 * A fresh socket and identity encoding keep binary response lifecycle isolated
 * from pooled JSON REST traffic and automatic decompression.
 */
export const createNodeSalesforceBinaryTransport = (
  timeoutMs = DEFAULT_TIMEOUT_MS,
): SalesforceBinaryTransport => {
  const fetchBinary = (
    input: SalesforceBinaryRequest,
    redirectsRemaining: number,
    includeAuthorization: boolean,
  ): Promise<SalesforceBinaryResponse> =>
    new Promise((resolve, reject) => {
      const url = new URL(input.url);
      const client = url.protocol === "https:" ? https : http;
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        reject(new Error("Salesforce binary URL must use HTTP or HTTPS."));
        return;
      }

      const request = client.request(
        url,
        {
          method: "GET",
          agent: false,
          headers: {
            accept: "image/*,application/octet-stream;q=0.9",
            "accept-encoding": "identity",
            connection: "close",
            ...(includeAuthorization
              ? { authorization: `Bearer ${input.accessToken}` }
              : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let settled = false;
          const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            response.destroy();
            reject(error);
          };

          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.once("aborted", () =>
            fail(new Error("Salesforce binary response was aborted.")),
          );
          response.once("error", fail);
          response.once("end", () => {
            if (settled) return;
            settled = true;
            const status = response.statusCode ?? 0;
            const buffer = Buffer.concat(chunks);
            const contentType = firstHeader(response.headers["content-type"]);
            const location = firstHeader(response.headers.location);

            if (
              location &&
              [301, 302, 303, 307, 308].includes(status) &&
              redirectsRemaining > 0
            ) {
              const redirectUrl = new URL(location, url);
              void fetchBinary(
                { ...input, url: redirectUrl.toString() },
                redirectsRemaining - 1,
                includeAuthorization && redirectUrl.origin === url.origin,
              ).then(resolve, reject);
              return;
            }
            resolve({ buffer, contentType, status });
          });
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error("Salesforce binary request timed out."));
      });
      request.once("error", reject);
      request.end();
    });

  return (request) => fetchBinary(request, MAX_REDIRECTS, true);
};

export const nodeSalesforceBinaryTransport =
  createNodeSalesforceBinaryTransport();
