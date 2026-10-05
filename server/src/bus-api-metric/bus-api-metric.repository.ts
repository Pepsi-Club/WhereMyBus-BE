import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BusApiMetric } from './bus-api-metric.schema';
import {
  BusApiMetricIdentity,
  MetricDimensionFilter,
} from './bus-api-metric.dimension';

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

interface AggregatedCounts {
  _id: null;
  requestCount: number;
  errorCount: number;
}

@Injectable()
export class BusApiMetricRepository {
  constructor(
    @InjectModel(BusApiMetric.name)
    private readonly model: Model<BusApiMetric>,
  ) {}

  async upsertBucket(bucket: StoredMetricBucket): Promise<void> {
    await this.model.updateOne(
      {
        bucketStart: bucket.bucketStart,
        instanceId: bucket.instanceId,
        provider: bucket.provider,
        operation: bucket.operation,
      },
      { $set: bucket },
      { upsert: true },
    );
  }

  async sumSince(
    start: Date,
    end: Date,
    filter?: MetricDimensionFilter,
  ): Promise<MetricCounts> {
    const [counts] = await this.model.aggregate<AggregatedCounts>([
      {
        $match: this.rangeMatch(start, end, filter),
      },
      {
        $group: {
          _id: null,
          requestCount: { $sum: '$requestCount' },
          errorCount: { $sum: '$errorCount' },
        },
      },
    ]);

    return counts
      ? {
          requestCount: counts.requestCount,
          errorCount: counts.errorCount,
        }
      : { requestCount: 0, errorCount: 0 };
  }

  async aggregateSeries(
    start: Date,
    end: Date,
    unit: MetricUnit,
    filter?: MetricDimensionFilter,
  ): Promise<MetricPoint[]> {
    return this.model.aggregate<MetricPoint>([
      {
        $match: this.rangeMatch(start, end, filter),
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$bucketStart',
              unit,
              timezone: 'Asia/Seoul',
            },
          },
          requestCount: { $sum: '$requestCount' },
          errorCount: { $sum: '$errorCount' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          start: '$_id',
          weekday: {
            $isoDayOfWeek: { date: '$_id', timezone: 'Asia/Seoul' },
          },
          requestCount: 1,
          errorCount: 1,
        },
      },
    ]);
  }

  async findLastCollectedAt(
    filter?: MetricDimensionFilter,
  ): Promise<Date | null> {
    const metric = await this.model
      .findOne(this.dimensionMatch(filter))
      .sort({ bucketStart: -1 })
      .select({ bucketStart: 1, _id: 0 })
      .lean();

    return metric?.bucketStart ?? null;
  }

  private rangeMatch(start: Date, end: Date, filter?: MetricDimensionFilter) {
    return {
      bucketStart: { $gte: start, $lt: end },
      ...this.dimensionMatch(filter),
    };
  }

  private dimensionMatch(filter?: MetricDimensionFilter) {
    return {
      ...(filter?.providers.length
        ? { provider: { $in: filter.providers } }
        : {}),
      ...(filter?.operations.length
        ? { operation: { $in: filter.operations } }
        : {}),
    };
  }
}
