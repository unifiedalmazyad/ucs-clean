import type { EventPayload } from './eventTypes';

/**
 * Placeholder integration bridge — future outbound delivery.
 *
 * When integrations (n8n, Odoo, custom webhook, etc.) are enabled via the
 * /api/integrations settings, this bridge will forward events to them.
 *
 * For now: no real network calls are made — just structured for future wiring.
 */
export async function deliverToIntegrations(payload: EventPayload): Promise<void> {
  // TODO (n8n): if n8n integration is enabled → POST payload to baseUrl + '/webhook/<endpoint>'
  // TODO (custom): if custom_api integration is enabled → POST payload to configured baseUrl
  // TODO (odoo): if odoo integration is enabled → call JSON-RPC method with payload
  // No-op until integrations are configured and enabled
}
