export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface DependencyHealth {
  /** Stable identifier of the dependency, e.g. `mongodb`. */
  name: string;
  status: HealthStatus;
  /** A required dependency being down takes the whole service down. */
  required: boolean;
  /** Round-trip time of the probe, when the dependency was reachable. */
  latencyMs?: number;
  /** Short human-readable reason, present when the status is not `ok`. */
  detail?: string;
}

export interface HealthPayload {
  status: HealthStatus;
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  dependencies: DependencyHealth[];
}

export interface LivenessPayload {
  status: 'ok';
  uptimeSeconds: number;
}
