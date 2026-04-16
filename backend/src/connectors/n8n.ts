import type { Connector, ConnectorConfig, ConnectorResult } from './interface';

export const n8nConnector: Connector = {
  async test(config: ConnectorConfig): Promise<ConnectorResult> {
    if (!config.baseUrl) {
      return { success: false, message: 'Base URL is required' };
    }
    const start = Date.now();
    try {
      const url = config.baseUrl.replace(/\/$/, '') + '/healthz';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['X-N8N-API-KEY'] = config.apiKey;

      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return { success: true, message: `n8n reachable (HTTP ${res.status})`, latencyMs };
      }
      return { success: false, message: `n8n returned HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e.message}`, latencyMs: Date.now() - start };
    }
  },
};
