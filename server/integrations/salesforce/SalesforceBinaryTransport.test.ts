import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNodeSalesforceBinaryTransport } from "./SalesforceBinaryTransport.ts";

const servers: Server[] = [];

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("Node Salesforce binary transport", () => {
  it("repeatedly consumes image responses and closes every dedicated socket", async () => {
    const sockets = new Set<Socket>();
    const receivedHeaders: Array<{
      authorization?: string;
      connection?: string;
      acceptEncoding?: string;
    }> = [];
    const image = Buffer.alloc(96 * 1024, 7);
    const server = createServer((request, response) => {
      receivedHeaders.push({
        authorization: request.headers.authorization,
        connection: request.headers.connection,
        acceptEncoding: request.headers["accept-encoding"],
      });
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": image.length,
      });
      response.end(image);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    const origin = await listen(server);
    const transport = createNodeSalesforceBinaryTransport(2_000);

    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        transport({ url: `${origin}/binary`, accessToken: "secret" }),
      ),
    );

    expect(responses).toHaveLength(40);
    expect(
      responses.every(
        ({ status, contentType, buffer }) =>
          status === 200 && contentType === "image/png" && buffer.equals(image),
      ),
    ).toBe(true);
    expect(receivedHeaders).toHaveLength(40);
    expect(receivedHeaders).toEqual(
      expect.arrayContaining([
        {
          authorization: "Bearer secret",
          connection: "close",
          acceptEncoding: "identity",
        },
      ]),
    );
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });

  it("rejects an incomplete response and releases its socket", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": 100_000,
      });
      response.end(Buffer.alloc(1_024));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    const origin = await listen(server);
    const transport = createNodeSalesforceBinaryTransport(2_000);

    await expect(
      transport({ url: `${origin}/truncated`, accessToken: "secret" }),
    ).rejects.toThrow("aborted");
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  });
});
