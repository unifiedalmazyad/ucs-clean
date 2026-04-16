export interface ConnectorConfig {
  baseUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  webhookSecret?: string;
}

export interface ConnectorResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  details?: any;
}

export interface Connector {
  test(config: ConnectorConfig): Promise<ConnectorResult>;
  pull?(config: ConnectorConfig): Promise<ConnectorResult>;
  push?(config: ConnectorConfig): Promise<ConnectorResult>;
}
