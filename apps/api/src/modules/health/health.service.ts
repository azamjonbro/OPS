import type {
  DependencyHealth,
  HealthPayload,
  HealthStatus,
  LivenessPayload,
} from '@hadiya/shared';

import { config } from '../../config/index.js';
import { probeDatabase } from '../../core/db/connection.js';

/**
 * A required dependency being unusable takes the service down; an optional one
 * only degrades it. Later phases add their own probes to this list.
 */
const checkDatabase = async (): Promise<DependencyHealth> => {
  const probe = await probeDatabase();

  if (probe.state === 'connected') {
    return {
      name: 'mongodb',
      status: 'ok',
      required: true,
      ...(probe.latencyMs === undefined ? {} : { latencyMs: probe.latencyMs }),
    };
  }

  return {
    name: 'mongodb',
    status: probe.state === 'connecting' ? 'degraded' : 'down',
    required: true,
    detail: probe.error ?? `connection is ${probe.state}`,
  };
};

const aggregateStatus = (dependencies: DependencyHealth[]): HealthStatus => {
  if (dependencies.some((dependency) => dependency.required && dependency.status === 'down')) {
    return 'down';
  }

  if (dependencies.some((dependency) => dependency.status !== 'ok')) {
    return 'degraded';
  }

  return 'ok';
};

export const getLiveness = (): LivenessPayload => ({
  status: 'ok',
  uptimeSeconds: Math.round(process.uptime()),
});

export const getHealth = async (): Promise<HealthPayload> => {
  const dependencies = await Promise.all([checkDatabase()]);

  return {
    status: aggregateStatus(dependencies),
    service: config.app.name,
    version: config.app.version,
    environment: config.app.env,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies,
  };
};
