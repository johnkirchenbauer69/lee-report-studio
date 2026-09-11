import {
  nodeSalesforceBinaryTransport,
  type SalesforceBinaryTransport,
} from "./SalesforceBinaryTransport.ts";

export interface SalesforceRecord {
  Id: string;
  [field: string]: unknown;
}
export interface SalesforceHealth {
  configured: boolean;
  connected: boolean;
  status?: "configured" | "authenticated" | "degraded" | "failed";
  instanceUrl?: string;
  instanceHostname?: string;
  authMode?: SalesforceAuthMode;
  apiVersion?: string;
  lastSuccessfulRequestAt?: string;
  lastHealthCheckAt?: string;
  lastAuthRefreshAt?: string;
  errorCode?: string;
}
export interface SalesforceBinaryResponse {
  buffer: Buffer;
  contentType: string;
  status: number;
}
export interface SalesforceClient {
  query<T extends SalesforceRecord>(soql: string): Promise<T[]>;
  health(): Promise<SalesforceHealth>;
  getApiCallCount?(): number;
  /**
   * Fetches raw binary content (e.g. an Attachment's Body or a
   * ContentVersion's VersionData) via an authenticated REST call.
   * `sobjectPath` is relative to `/services/data/v{apiVersion}/`, e.g.
   * `sobjects/Attachment/{id}/Body`. Never exposes the access token to the
   * caller — authentication happens entirely inside this method.
   */
  getBinary?(
    sobjectPath: string,
    options?: { maxBytes?: number },
  ): Promise<SalesforceBinaryResponse>;
}
interface SalesforceQueryResponse<T> {
  records: T[];
  done: boolean;
  nextRecordsUrl?: string;
}
export type SalesforceAuthMode = "client-credentials" | "soap-login";
export interface SalesforceAuthSession {
  accessToken: string;
  instanceUrl: string;
}
export interface SalesforceAuthStrategy {
  readonly mode: SalesforceAuthMode;
  authenticate(): Promise<SalesforceAuthSession>;
}
const safeError = (kind: string, status: number) =>
  new Error(
    `Salesforce ${kind} failed (${status}). No alternate authentication mode was attempted.`,
  );

export class ClientCredentialsAuthStrategy implements SalesforceAuthStrategy {
  readonly mode = "client-credentials" as const;
  constructor(
    private readonly config: {
      loginUrl: string;
      clientId: string;
      clientSecret: string;
      instanceUrl?: string;
    },
  ) {}
  async authenticate(): Promise<SalesforceAuthSession> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const response = await fetch(
      `${this.config.loginUrl}/services/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!response.ok)
      throw safeError("client-credentials authentication", response.status);
    const token = (await response.json()) as {
      access_token?: string;
      instance_url?: string;
    };
    const instanceUrl = token.instance_url ?? this.config.instanceUrl;
    if (!token.access_token || !instanceUrl)
      throw new Error(
        "Salesforce client-credentials authentication returned an incomplete response.",
      );
    return {
      accessToken: token.access_token,
      instanceUrl: instanceUrl.replace(/\/$/, ""),
    };
  }
}

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const xmlValue = (xml: string, name: string) =>
  xml.match(
    new RegExp(`<(?:\\w+:)?${name}>([^<]+)</(?:\\w+:)?${name}>`, "i"),
  )?.[1];
export class SoapLoginAuthStrategy implements SalesforceAuthStrategy {
  readonly mode = "soap-login" as const;
  constructor(
    private readonly config: {
      username: string;
      password: string;
      securityToken: string;
      domain: "login" | "test";
      apiVersion: string;
    },
  ) {}
  async authenticate(): Promise<SalesforceAuthSession> {
    const endpoint = `https://${this.config.domain}.salesforce.com/services/Soap/u/${this.config.apiVersion}`;
    const envelope = `<?xml version="1.0" encoding="utf-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:n1="urn:partner.soap.sforce.com"><env:Body><n1:login><n1:username>${xmlEscape(this.config.username)}</n1:username><n1:password>${xmlEscape(this.config.password + this.config.securityToken)}</n1:password></n1:login></env:Body></env:Envelope>`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=UTF-8",
        SOAPAction: "login",
      },
      body: envelope,
    });
    if (!response.ok) throw safeError("SOAP login", response.status);
    const xml = await response.text();
    const accessToken = xmlValue(xml, "sessionId");
    const serverUrl = xmlValue(xml, "serverUrl");
    if (!accessToken || !serverUrl)
      throw new Error("Salesforce SOAP login returned an incomplete response.");
    return { accessToken, instanceUrl: new URL(serverUrl).origin };
  }
}

export interface SalesforceRestConfig {
  authStrategy: SalesforceAuthStrategy;
  apiVersion: string;
  fetch?: typeof fetch;
  binaryTransport?: SalesforceBinaryTransport;
  now?: () => Date;
  logger?: (entry: Record<string, unknown>) => void;
}

export class SalesforceRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | "SALESFORCE_AUTH_EXPIRED"
      | "SALESFORCE_REAUTH_FAILED"
      | "SALESFORCE_REQUEST_FAILED",
    readonly status?: number,
  ) {
    super(message);
    this.name = "SalesforceRequestError";
  }
}

export class SalesforceRestClient implements SalesforceClient {
  private session?: SalesforceAuthSession;
  private authInFlight?: Promise<SalesforceAuthSession>;
  private apiCallCount = 0;
  private lastSuccessfulRequestAt?: string;
  private lastHealthCheckAt?: string;
  private lastAuthRefreshAt?: string;
  private state: SalesforceHealth["status"] = "configured";
  constructor(private readonly config: SalesforceRestConfig) {}

  private timestamp() {
    return (this.config.now?.() ?? new Date()).toISOString();
  }

  private log(event: string, extra: Record<string, unknown> = {}) {
    (this.config.logger ?? ((entry) => console.info(JSON.stringify(entry))))({
      event,
      authMode: this.config.authStrategy.mode,
      ...extra,
    });
  }

  private async authenticate(refresh = false) {
    if (this.session) return this.session;
    if (!this.authInFlight) {
      if (refresh) {
        this.state = "degraded";
        this.log("salesforce_reauth_started");
      }
      this.apiCallCount += 1;
      this.authInFlight = this.config.authStrategy
        .authenticate()
        .then((session) => {
          this.session = session;
          this.lastAuthRefreshAt = this.timestamp();
          this.state = "authenticated";
          if (refresh) this.log("salesforce_reauth_succeeded");
          return session;
        })
        .catch((error) => {
          this.state = "failed";
          if (refresh)
            this.log("salesforce_reauth_failed", {
              errorName: error instanceof Error ? error.name : "UnknownError",
            });
          throw refresh
            ? new SalesforceRequestError(
                "Salesforce reauthentication failed.",
                "SALESFORCE_REAUTH_FAILED",
              )
            : error;
        })
        .finally(() => {
          this.authInFlight = undefined;
        });
    }
    return this.authInFlight;
  }

  private invalidate(session: SalesforceAuthSession) {
    if (this.session === session) this.session = undefined;
  }

  private async authenticatedRequest<T extends { status: number }>(
    operation: string,
    request: (session: SalesforceAuthSession) => Promise<T>,
    dispose?: (response: T) => Promise<void>,
  ): Promise<T> {
    const issue = async (session: SalesforceAuthSession) => {
      this.apiCallCount += 1;
      return request(session);
    };
    const recordSuccess = (response: T) => {
      if (response.status >= 200 && response.status < 300) {
        this.lastSuccessfulRequestAt = this.timestamp();
        this.state = "authenticated";
      }
    };

    const session = await this.authenticate();
    let response = await issue(session);
    if (response.status !== 401) {
      recordSuccess(response);
      return response;
    }

    // A response that is retried must be explicitly consumed. Node does not
    // guarantee prompt GC disposal, and an unread Undici body can pin a pooled
    // socket or leave its HTTP/1 parser paused when the peer closes it.
    await dispose?.(response);
    this.state = "degraded";
    this.log("salesforce_auth_expired_detected", { operation });
    this.invalidate(session);
    const refreshed = await this.authenticate(true);
    this.log("salesforce_query_retry", { operation, retry: 1 });
    response = await issue(refreshed);
    recordSuccess(response);
    if (response.status === 401) this.state = "failed";
    return response;
  }

  private async authenticatedFetch(
    path: string,
    init: RequestInit = {},
    operation = "request",
  ): Promise<Response> {
    return this.authenticatedRequest(
      operation,
      (session) =>
        (this.config.fetch ?? fetch)(`${session.instanceUrl}${path}`, {
          ...init,
          headers: {
            ...init.headers,
            authorization: `Bearer ${session.accessToken}`,
          },
        }),
      async (response) => {
        if (!response.bodyUsed) await response.arrayBuffer();
      },
    );
  }

  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    const records: T[] = [];
    let path = `/services/data/v${this.config.apiVersion}/query?q=${encodeURIComponent(soql)}`;
    while (path) {
      const response = await this.authenticatedFetch(path, {}, "query");
      if (!response.ok)
        throw new SalesforceRequestError(
          `Salesforce query failed (${response.status}).`,
          response.status === 401
            ? "SALESFORCE_AUTH_EXPIRED"
            : "SALESFORCE_REQUEST_FAILED",
          response.status,
        );
      const page = (await response.json()) as SalesforceQueryResponse<T>;
      records.push(...page.records);
      path = page.nextRecordsUrl ?? "";
    }
    return records;
  }
  async getBinary(
    sobjectPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<SalesforceBinaryResponse> {
    return this.authenticatedRequest("binary", (session) =>
      (this.config.binaryTransport ?? nodeSalesforceBinaryTransport)({
        url: `${session.instanceUrl}/services/data/v${this.config.apiVersion}/${sobjectPath}`,
        accessToken: session.accessToken,
        maxBytes: options.maxBytes,
      }),
    );
  }
  async health(): Promise<SalesforceHealth> {
    this.lastHealthCheckAt = this.timestamp();
    if (this.state === "degraded" && this.authInFlight)
      return {
        configured: true,
        connected: false,
        status: "degraded",
        authMode: this.config.authStrategy.mode,
        apiVersion: this.config.apiVersion,
        lastSuccessfulRequestAt: this.lastSuccessfulRequestAt,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastAuthRefreshAt: this.lastAuthRefreshAt,
      };
    try {
      const response = await this.authenticatedFetch(
        `/services/data/v${this.config.apiVersion}/limits/`,
        {},
        "health_probe",
      );
      if (!response.ok)
        throw new SalesforceRequestError(
          `Salesforce health probe failed (${response.status}).`,
          response.status === 401
            ? "SALESFORCE_AUTH_EXPIRED"
            : "SALESFORCE_REQUEST_FAILED",
          response.status,
        );
      await response.arrayBuffer();
      const session = this.session!;
      return {
        configured: true,
        connected: true,
        status: "authenticated",
        instanceUrl: session.instanceUrl,
        instanceHostname: new URL(session.instanceUrl).hostname,
        authMode: this.config.authStrategy.mode,
        apiVersion: this.config.apiVersion,
        lastSuccessfulRequestAt: this.lastSuccessfulRequestAt,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastAuthRefreshAt: this.lastAuthRefreshAt,
      };
    } catch (error) {
      this.state = "failed";
      return {
        configured: true,
        connected: false,
        status: "failed",
        authMode: this.config.authStrategy.mode,
        apiVersion: this.config.apiVersion,
        lastSuccessfulRequestAt: this.lastSuccessfulRequestAt,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastAuthRefreshAt: this.lastAuthRefreshAt,
        errorCode:
          error instanceof SalesforceRequestError
            ? error.code
            : "SALESFORCE_REQUEST_FAILED",
      };
    }
  }
  getApiCallCount() {
    return this.apiCallCount;
  }
}
