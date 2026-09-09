import "dotenv/config";
import { readFile } from "node:fs/promises";

import { createNodeSalesforceBinaryTransport } from "../server/integrations/salesforce/SalesforceBinaryTransport.ts";
import { loadSalesforceConfig } from "../server/integrations/salesforce/config.ts";

const mode = process.argv[2] ?? "fetch-consume";
const count = Number(process.argv[3] ?? 40);
const config = loadSalesforceConfig();
const session = await config.authStrategy.authenticate();
const index = JSON.parse(
  await readFile("server/data/salesforceImages.json", "utf8"),
) as Record<string, string>;
const ids = Object.keys(index).slice(0, count);
const pathFor = (id: string) =>
  id.startsWith("00P")
    ? `sobjects/Attachment/${id}/Body`
    : `sobjects/ContentVersion/${id}/VersionData`;
const urlFor = (id: string) =>
  `${session.instanceUrl}/services/data/v${config.apiVersion}/${pathFor(id)}`;

if (!ids.length) throw new Error("The local Salesforce image index is empty.");

if (mode === "native") {
  const transport = createNodeSalesforceBinaryTransport();
  const responses = await Promise.all(
    ids.map((id) =>
      transport({ url: urlFor(id), accessToken: session.accessToken }),
    ),
  );
  console.log(
    JSON.stringify({
      mode,
      completed: responses.length,
      successful: responses.filter((response) => response.status === 200)
        .length,
      bytes: responses.reduce(
        (sum, response) => sum + response.buffer.length,
        0,
      ),
    }),
  );
} else {
  const fetchOne = (id: string) =>
    fetch(urlFor(id), {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        ...(mode.includes("close") ? { connection: "close" } : {}),
        ...(mode.includes("identity") ? { "accept-encoding": "identity" } : {}),
      },
    });
  if (mode.includes("unread")) {
    const responses = await Promise.all(ids.map(fetchOne));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    console.log(
      JSON.stringify({
        mode,
        completed: responses.length,
        successful: responses.filter((response) => response.ok).length,
      }),
    );
  } else if (mode === "fetch-consume") {
    const responses = await Promise.all(
      ids.map(async (id) => {
        const response = await fetchOne(id);
        const bytes = await response.arrayBuffer();
        return { response, bytes };
      }),
    );
    console.log(
      JSON.stringify({
        mode,
        completed: responses.length,
        successful: responses.filter(({ response }) => response.ok).length,
        bytes: responses.reduce(
          (sum, response) => sum + response.bytes.byteLength,
          0,
        ),
      }),
    );
  } else {
    throw new Error(`Unknown probe mode: ${mode}`);
  }
}
