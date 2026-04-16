import type { Connector, ConnectorConfig, ConnectorResult } from './interface';

export const customConnector: Connector = {
  async test(config: ConnectorConfig): Promise<ConnectorResult> {
    if (!config.baseUrl) {
      return { success: false, message: 'Base URL is required' };
    }
    const start = Date.now();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

      const res = await fetch(config.baseUrl, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - start;

      return { success: res.ok, message: `HTTP ${res.status} — ${res.ok ? 'reachable' : 'not OK'}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: `Custom API unreachable: ${e.message}`, latencyMs: Date.now() - start };
    }
  },
  async pull(config: ConnectorConfig): Promise<ConnectorResult> {
    return { success: false, message: 'Pull not implemented for custom connector yet' };
  },
};
