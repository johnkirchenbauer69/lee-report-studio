import { describe, expect, it, vi } from "vitest";
import {
  SalesforceRequestError,
  SalesforceRestClient,
  type SalesforceAuthStrategy,
} from "./SalesforceClient";

const page = (records: Array<{ Id: string }> = [{ Id: "record-1" }]) =>
  new Response(JSON.stringify({ records, done: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const setup = (responses: Array<Response | (() => Promise<Response>)>) => {
  let auth = 0;
  const strategy: SalesforceAuthStrategy = {
    mode: "soap-login",
    authenticate: vi.fn(async () => ({
      accessToken: `token-${++auth}`,
      instanceUrl: "https://example.my.salesforce.com",
    })),
  };
  const fetcher = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected fetch");
      return typeof response === "function" ? response() : response;
    },
  );
  const client = new SalesforceRestClient({
    authStrategy: strategy,
    apiVersion: "64.0",
    fetch: fetcher,
    logger: () => undefined,
  });
  return { client, strategy, fetcher };
};

describe("SalesforceRestClient authenticated retry", () => {
  it("serves a normal request without refreshing", async () => {
    const { client, strategy } = setup([page()]);
    await expect(client.query("SELECT Id FROM Account")).resolves.toHaveLength(
      1,
    );
    expect(strategy.authenticate).toHaveBeenCalledTimes(1);
  });

  it("reauthenticates once after a 401 and retries the original query", async () => {
    const { client, strategy, fetcher } = setup([
      new Response(JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }]), {
        status: 401,
      }),
      page(),
    ]);
    await expect(client.query("SELECT Id FROM Account")).resolves.toHaveLength(
      1,
    );
    expect(strategy.authenticate).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({
      authorization: "Bearer token-1",
    });
    expect(fetcher.mock.calls[1]![1]!.headers).toMatchObject({
      authorization: "Bearer token-2",
    });
  });

  it("consumes an unread 401 body before retrying JSON REST", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const expired = {
      status: 401,
      ok: false,
      bodyUsed: false,
      arrayBuffer,
    } as unknown as Response;
    const { client } = setup([expired, page()]);

    await expect(client.query("SELECT Id FROM Account")).resolves.toHaveLength(
      1,
    );
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("consumes the successful health probe body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const probe = {
      status: 200,
      ok: true,
      arrayBuffer,
    } as unknown as Response;
    const { client } = setup([probe]);

    await expect(client.health()).resolves.toMatchObject({ connected: true });
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("isolates repeated binary requests while retaining single-flight reauth", async () => {
    let authCalls = 0;
    const strategy: SalesforceAuthStrategy = {
      mode: "soap-login",
      authenticate: vi.fn(async () => ({
        accessToken: `token-${++authCalls}`,
        instanceUrl: "https://example.test",
      })),
    };
    const binaryTransport = vi.fn(
      async ({ accessToken }: { accessToken: string }) =>
        accessToken === "token-1"
          ? {
              status: 401,
              contentType: "application/json",
              buffer: Buffer.alloc(0),
            }
          : {
              status: 200,
              contentType: "image/png",
              buffer: Buffer.alloc(96 * 1024),
            },
    );
    const jsonFetch = vi.fn<typeof fetch>();
    const client = new SalesforceRestClient({
      authStrategy: strategy,
      apiVersion: "64.0",
      fetch: jsonFetch,
      binaryTransport,
      logger: () => undefined,
    });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.getBinary("sobjects/Attachment/redacted/Body"),
      ),
    );

    expect(responses).toHaveLength(20);
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(strategy.authenticate).toHaveBeenCalledTimes(2);
    expect(binaryTransport).toHaveBeenCalledTimes(40);
    expect(jsonFetch).not.toHaveBeenCalled();
  });

  it("returns a reauth failure and does not issue a hidden retry", async () => {
    const strategy: SalesforceAuthStrategy = {
      mode: "client-credentials",
      authenticate: vi
        .fn()
        .mockResolvedValueOnce({
          accessToken: "expired",
          instanceUrl: "https://example.test",
        })
        .mockRejectedValueOnce(new Error("login rejected")),
    };
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    const client = new SalesforceRestClient({
      authStrategy: strategy,
      apiVersion: "64.0",
      fetch: fetcher,
      logger: () => undefined,
    });
    await expect(client.query("SELECT Id FROM Account")).rejects.toMatchObject({
      code: "SALESFORCE_REAUTH_FAILED",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns the real retry failure without a second refresh", async () => {
    const { client, strategy } = setup([
      new Response(null, { status: 401 }),
      new Response(null, { status: 500 }),
    ]);
    await expect(client.query("SELECT Id FROM Account")).rejects.toMatchObject({
      code: "SALESFORCE_REQUEST_FAILED",
      status: 500,
    } satisfies Partial<SalesforceRequestError>);
    expect(strategy.authenticate).toHaveBeenCalledTimes(2);
  });

  it.each([400, 403, 500])(
    "does not reauthenticate for HTTP %s",
    async (status) => {
      const { client, strategy } = setup([new Response(null, { status })]);
      await expect(client.query("bad query")).rejects.toMatchObject({ status });
      expect(strategy.authenticate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([2, 10])(
    "single-flights refresh for %s simultaneous expired requests",
    async (count) => {
      let authCalls = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const strategy: SalesforceAuthStrategy = {
        mode: "soap-login",
        authenticate: vi.fn(async () => {
          authCalls += 1;
          if (authCalls === 2) await gate;
          return {
            accessToken: `token-${authCalls}`,
            instanceUrl: "https://example.test",
          };
        }),
      };
      const fetcher = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const token = (init?.headers as Record<string, string>).authorization;
          return token === "Bearer token-1"
            ? new Response(null, { status: 401 })
            : page();
        },
      );
      const client = new SalesforceRestClient({
        authStrategy: strategy,
        apiVersion: "64.0",
        fetch: fetcher,
        logger: () => undefined,
      });
      const requests = Array.from({ length: count }, () =>
        client.query("SELECT Id FROM Account"),
      );
      await vi.waitFor(() =>
        expect(strategy.authenticate).toHaveBeenCalledTimes(2),
      );
      release();
      await expect(Promise.all(requests)).resolves.toHaveLength(count);
      expect(strategy.authenticate).toHaveBeenCalledTimes(2);
    },
  );

  it("reports degraded while a single-flight refresh is in progress", async () => {
    let authCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const strategy: SalesforceAuthStrategy = {
      mode: "client-credentials",
      authenticate: vi.fn(async () => {
        authCalls += 1;
        if (authCalls === 2) await gate;
        return {
          accessToken: `token-${authCalls}`,
          instanceUrl: "https://example.test",
        };
      }),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(page());
    const client = new SalesforceRestClient({
      authStrategy: strategy,
      apiVersion: "64.0",
      fetch: fetcher,
      logger: () => undefined,
    });
    await client.query("SELECT Id FROM Account");
    const retrying = client.query("SELECT Id FROM Account");
    await vi.waitFor(() =>
      expect(strategy.authenticate).toHaveBeenCalledTimes(2),
    );
    await expect(client.health()).resolves.toMatchObject({
      connected: false,
      status: "degraded",
    });
    release();
    await expect(retrying).resolves.toHaveLength(1);
  });

  it("health fails after an authenticated probe fails and recovers through reauth", async () => {
    const { client } = setup([
      page(),
      new Response(null, { status: 401 }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 401 }),
      page([]),
    ]);
    await client.query("SELECT Id FROM Account");
    await expect(client.health()).resolves.toMatchObject({
      configured: true,
      connected: false,
      status: "failed",
      authMode: "soap-login",
      apiVersion: "64.0",
    });
    await expect(client.health()).resolves.toMatchObject({
      connected: true,
      status: "authenticated",
      instanceHostname: "example.my.salesforce.com",
    });
  });
});
