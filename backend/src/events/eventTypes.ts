// Centralized event type definitions — keep in sync with integration bridge
export const EventTypes = {
  WORK_ORDER_CREATED:      'work_order.created',
  WORK_ORDER_UPDATED:      'work_order.updated',
  WORK_ORDER_STAGE_CHANGED:'work_order.stage_changed',
  PROJECT_COMPLETED:       'project.completed',
  KPI_ALERT:               'kpi.alert',
  COMMENT_CREATED:         'comment.created',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

export interface EventPayload {
  event: EventType;
  entityId: string;
  user: string;
  timestamp: number;
  data: Record<string, any>;
}
