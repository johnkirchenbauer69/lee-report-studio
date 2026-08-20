export interface SalesforceRecord {
  Id: string;
  [field: string]: unknown;
}
export interface SalesforceHealth {
  configured: boolean;
  connected: boolean;
  instanceUrl?: string;
  authMode?: SalesforceAuthMode;
  apiVersion?: string;
}
export interface SalesforceClient {
  query<T extends SalesforceRecord>(soql: string): Promise<T[]>;
  health(): Promise<SalesforceHealth>;
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
}
export class SalesforceRestClient implements SalesforceClient {
  private session?: SalesforceAuthSession;
  constructor(private readonly config: SalesforceRestConfig) {}
  private async authenticate() {
    this.session ??= await this.config.authStrategy.authenticate();
    return this.session;
  }
  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    const session = await this.authenticate();
    const records: T[] = [];
    let url = `${session.instanceUrl}/services/data/v${this.config.apiVersion}/query?q=${encodeURIComponent(soql)}`;
    do {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok)
        throw new Error(`Salesforce query failed (${response.status}).`);
      const page = (await response.json()) as SalesforceQueryResponse<T>;
      records.push(...page.records);
      url = page.nextRecordsUrl
        ? `${session.instanceUrl}${page.nextRecordsUrl}`
        : "";
    } while (url);
    return records;
  }
  async health(): Promise<SalesforceHealth> {
    try {
      const session = await this.authenticate();
      return {
        configured: true,
        connected: true,
        instanceUrl: session.instanceUrl,
        authMode: this.config.authStrategy.mode,
        apiVersion: this.config.apiVersion,
      };
    } catch {
      return {
        configured: true,
        connected: false,
        authMode: this.config.authStrategy.mode,
        apiVersion: this.config.apiVersion,
      };
    }
  }
}
