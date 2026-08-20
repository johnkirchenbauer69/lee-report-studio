export interface SalesforceRecord {
  Id: string;
  [field: string]: unknown;
}

export interface SalesforceClient {
  query<T extends SalesforceRecord>(soql: string): Promise<T[]>;
  health(): Promise<{
    configured: boolean;
    connected: boolean;
    instanceUrl?: string;
  }>;
}

interface SalesforceQueryResponse<T> {
  records: T[];
  done: boolean;
  nextRecordsUrl?: string;
}

export interface SalesforceRestConfig {
  loginUrl: string;
  clientId: string;
  clientSecret: string;
  instanceUrl?: string;
  apiVersion: string;
}

export class SalesforceRestClient implements SalesforceClient {
  private accessToken?: string;
  private resolvedInstanceUrl?: string;
  private readonly config: SalesforceRestConfig;

  constructor(config: SalesforceRestConfig) {
    this.config = config;
  }

  private async authenticate() {
    if (this.accessToken && this.resolvedInstanceUrl) return;
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
    if (!response.ok) {
      throw new Error(`Salesforce authentication failed (${response.status}).`);
    }
    const token = (await response.json()) as {
      access_token?: string;
      instance_url?: string;
    };
    if (
      !token.access_token ||
      !(token.instance_url || this.config.instanceUrl)
    ) {
      throw new Error(
        "Salesforce authentication returned an incomplete response.",
      );
    }
    this.accessToken = token.access_token;
    this.resolvedInstanceUrl = token.instance_url ?? this.config.instanceUrl;
  }

  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    await this.authenticate();
    const records: T[] = [];
    let url = `${this.resolvedInstanceUrl}/services/data/v${this.config.apiVersion}/query?q=${encodeURIComponent(soql)}`;
    do {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${this.accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`Salesforce query failed (${response.status}).`);
      }
      const page = (await response.json()) as SalesforceQueryResponse<T>;
      records.push(...page.records);
      url = page.nextRecordsUrl
        ? `${this.resolvedInstanceUrl}${page.nextRecordsUrl}`
        : "";
    } while (url);
    return records;
  }

  async health() {
    try {
      await this.authenticate();
      return {
        configured: true,
        connected: true,
        instanceUrl: this.resolvedInstanceUrl,
      };
    } catch {
      return { configured: true, connected: false };
    }
  }
}
