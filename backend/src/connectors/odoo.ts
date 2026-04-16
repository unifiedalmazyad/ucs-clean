import type { Connector, ConnectorConfig, ConnectorResult } from './interface';

export const odooConnector: Connector = {
  async test(config: ConnectorConfig): Promise<ConnectorResult> {
    if (!config.baseUrl) {
      return { success: false, message: 'Base URL is required' };
    }
    const start = Date.now();
    try {
      const url = config.baseUrl.replace(/\/$/, '') + '/web/dataset/call_kw';
      const body = JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        id: 1,
        params: {
          model: 'res.users',
          method: 'search_read',
          args: [[['id', '=', 1]]],
          kwargs: { fields: ['name'], limit: 1 },
        },
      });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.accessToken) headers['Authorization'] = `Bearer ${config.accessToken}`;

      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(7000) });
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return { success: false, message: `Odoo returned HTTP ${res.status}`, latencyMs };
      }
      const json: any = await res.json();
      if (json?.error) {
        return { success: false, message: `Odoo JSON-RPC error: ${json.error.message || JSON.stringify(json.error)}`, latencyMs };
      }
      return { success: true, message: 'Odoo JSON-RPC reachable', latencyMs };
    } catch (e: any) {
      return { success: false, message: `Odoo connection failed: ${e.message}`, latencyMs: Date.now() - start };
    }
  },
};
