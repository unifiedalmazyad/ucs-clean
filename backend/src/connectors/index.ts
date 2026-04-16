import { n8nConnector } from './n8n';
import { jisrConnector } from './jisr';
import { odooConnector } from './odoo';
import { customConnector } from './custom';
import type { Connector } from './interface';

export const connectors: Record<string, Connector> = {
  n8n: n8nConnector,
  jisr: jisrConnector,
  odoo: odooConnector,
  custom: customConnector,
};

export type { Connector, ConnectorConfig, ConnectorResult } from './interface';
