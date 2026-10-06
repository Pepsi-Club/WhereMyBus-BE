import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional } from 'class-validator';
import { BUS_API_METRIC_DIMENSIONS } from '../../bus-api-metric/bus-api-metric.dimension';
import { DASHBOARD_RANGES } from './dashboard-metric.contract';
import type { DashboardRange } from './dashboard-metric.contract';

const MAX_FILTER_LENGTH = 256;
const METRIC_PROVIDER_KEYS = BUS_API_METRIC_DIMENSIONS.map(
  ({ provider }) => provider,
);
const METRIC_OPERATION_KEYS = BUS_API_METRIC_DIMENSIONS.map(
  ({ operation }) => operation,
);

function parseCsvFilter(value: unknown): string[] | { invalid: true } {
  if (typeof value !== 'string' || value.length > MAX_FILTER_LENGTH) {
    return { invalid: true };
  }
  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) {
    return [];
  }
  return [...new Set(tokens)];
}

export class DashboardMetricQueryDto {
  @IsIn(DASHBOARD_RANGES)
  range: DashboardRange;

  @IsOptional()
  @Transform(({ value }) => parseCsvFilter(value), { toClassOnly: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(METRIC_PROVIDER_KEYS, { each: true })
  providers?: string[];

  @IsOptional()
  @Transform(({ value }) => parseCsvFilter(value), { toClassOnly: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(METRIC_OPERATION_KEYS, { each: true })
  operations?: string[];
}
