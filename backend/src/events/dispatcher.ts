import type { EventType, EventPayload } from './eventTypes';
import { deliverToIntegrations } from './integrationBridge';

// In-memory capped event store — non-persistent, for diagnostics only
const MAX_EVENTS = 200;
const recentEvents: EventPayload[] = [];

/** Return a snapshot of the recent in-memory events (read-only) */
export function getRecentEvents(): ReadonlyArray<EventPayload> {
  return recentEvents;
}

/**
 * Emit an internal event.
 *
 * Behavior:
 * 1. Log to console
 * 2. Push to capped in-memory array
 * 3. Forward to integration bridge (placeholder — fire-and-forget, never throws)
 *
 * This function is intentionally non-blocking and must never throw.
 * If anything here fails, the original request flow is unaffected.
 */
export function emitEvent(
  eventType: EventType,
  entityId: string,
  user: string,
  data: Record<string, any> = {},
): void {
  try {
    const payload: EventPayload = {
      event: eventType,
      entityId,
      user,
      timestamp: Date.now(),
      data,
    };

    // 1. Log
    console.log(`[EVENT] ${payload.event} | entity=${payload.entityId} | user=${payload.user}`);

    // 2. Store in capped ring buffer
    recentEvents.push(payload);
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
    }

    // 3. Forward to integration bridge — fire-and-forget
    deliverToIntegrations(payload).catch(() => {
      // Bridge errors must never surface to callers
    });
  } catch {
    // Silently swallow — event dispatch must never break the original request
  }
}
