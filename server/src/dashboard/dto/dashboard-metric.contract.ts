import type { MetricDimensionFilter } from '../../bus-api-metric/bus-api-metric.dimension';
import type { MetricCounts } from '../../bus-api-metric/bus-api-metric.types';

export const DASHBOARD_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export interface DashboardSeriesPoint extends MetricCounts {
  start: string;
  weekday: number;
}

export interface DashboardMetricsResponse {
  range: DashboardRange;
  timezone: 'Asia/Seoul';
  filters: MetricDimensionFilter;
  summary: {
    todayRequests: number;
    monthRequests: number;
    rangeRequests: number;
    rangeErrors: number;
    errorRate: number;
    lastCollectedAt: string | null;
  };
  series: DashboardSeriesPoint[];
}
