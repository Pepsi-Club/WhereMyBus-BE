import type { BusApiMetricIdentity } from './bus-api-metric.dimension';

export type MetricUnit = 'hour' | 'day';

export interface MetricCounts {
  requestCount: number;
  errorCount: number;
}

export interface MetricPoint extends MetricCounts {
  start: Date;
  weekday: number;
}

export interface StoredMetricBucket extends MetricCounts, BusApiMetricIdentity {
  bucketStart: Date;
  instanceId: string;
  expiresAt: Date;
}

export interface AggregatedCounts extends MetricCounts {
  _id: null;
}
