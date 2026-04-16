import type { Connector, ConnectorConfig, ConnectorResult } from './interface';

export const jisrConnector: Connector = {
  async test(config: ConnectorConfig): Promise<ConnectorResult> {
    if (!config.baseUrl) {
      return { success: false, message: 'Base URL is required. Jisr API endpoint not fully configured yet.' };
    }
    const start = Date.now();
    try {
      const url = config.baseUrl.replace(/\/$/, '') + '/ping';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return { success: true, message: `Jisr reachable (HTTP ${res.status})`, latencyMs };
      }
      return { success: false, message: `Jisr returned HTTP ${res.status} — please verify API URL and credentials`, latencyMs };
    } catch (e: any) {
      return { success: false, message: `Jisr connection failed: ${e.message}`, latencyMs: Date.now() - start };
    }
  },
};
