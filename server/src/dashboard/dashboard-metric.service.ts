import { BadRequestException, Injectable } from '@nestjs/common';
import { BusApiMetricRepository } from '../bus-api-metric/bus-api-metric.repository';
import type { MetricUnit } from '../bus-api-metric/bus-api-metric.types';
import {
  getMetricDimensionCatalog,
  MetricDimensionFilter,
  resolveMetricDimensionFilter,
} from '../bus-api-metric/bus-api-metric.dimension';

export const DASHBOARD_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

interface DashboardSeriesPoint {
  start: string;
  weekday: number;
  requestCount: number;
  errorCount: number;
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEOUL_OFFSET_MS = 9 * HOUR_MS;

const RANGE_CONFIG: Record<
  DashboardRange,
  { durationMs: number; unit: MetricUnit }
> = {
  '24h': { durationMs: 24 * HOUR_MS, unit: 'hour' },
  '7d': { durationMs: 7 * DAY_MS, unit: 'hour' },
  '30d': { durationMs: 30 * DAY_MS, unit: 'day' },
  '90d': { durationMs: 90 * DAY_MS, unit: 'day' },
};

@Injectable()
export class DashboardMetricService {
  constructor(private readonly repository: BusApiMetricRepository) {}

  getDimensions() {
    return getMetricDimensionCatalog();
  }

  async getMetrics(
    range: DashboardRange,
    selection: { providers?: string[]; operations?: string[] } = {},
    now = new Date(),
  ): Promise<DashboardMetricsResponse> {
    const filters = resolveMetricDimensionFilter(selection);
    if (!filters) {
      throw new BadRequestException('Invalid metric dimension filter');
    }
    const { durationMs, unit } = RANGE_CONFIG[range];
    const rangeStart = new Date(now.getTime() - durationMs);
    const todayStart = this.startOfSeoulDay(now);
    const monthStart = this.startOfSeoulMonth(now);

    const [today, month, rangeCounts, points, lastCollectedAt] =
      await Promise.all([
        this.repository.sumSince(todayStart, now),
        this.repository.sumSince(monthStart, now),
        this.repository.sumSince(rangeStart, now, filters),
        this.repository.aggregateSeries(rangeStart, now, unit, filters),
        this.repository.findLastCollectedAt(filters),
      ]);

    return {
      range,
      timezone: 'Asia/Seoul',
      filters,
      summary: {
        todayRequests: today.requestCount,
        monthRequests: month.requestCount,
        rangeRequests: rangeCounts.requestCount,
        rangeErrors: rangeCounts.errorCount,
        errorRate:
          rangeCounts.requestCount === 0
            ? 0
            : rangeCounts.errorCount / rangeCounts.requestCount,
        lastCollectedAt: lastCollectedAt?.toISOString() ?? null,
      },
      series: points.map((point) => ({
        start: this.toSeoulIso(point.start),
        weekday: point.weekday,
        requestCount: point.requestCount,
        errorCount: point.errorCount,
      })),
    };
  }

  private startOfSeoulDay(now: Date): Date {
    const local = new Date(now.getTime() + SEOUL_OFFSET_MS);
    return new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate(),
      ) - SEOUL_OFFSET_MS,
    );
  }

  private startOfSeoulMonth(now: Date): Date {
    const local = new Date(now.getTime() + SEOUL_OFFSET_MS);
    return new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) -
        SEOUL_OFFSET_MS,
    );
  }

  private toSeoulIso(date: Date): string {
    const local = new Date(date.getTime() + SEOUL_OFFSET_MS);
    return `${local.toISOString().slice(0, 19)}+09:00`;
  }
}
