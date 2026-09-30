import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BusApiMetric } from './bus-api-metric.schema';

export type MetricUnit = 'hour' | 'day';

export interface MetricCounts {
  requestCount: number;
  errorCount: number;
}

export interface MetricPoint extends MetricCounts {
  start: Date;
}

export interface StoredMetricBucket extends MetricCounts {
  bucketStart: Date;
  instanceId: string;
  expiresAt: Date;
}

interface AggregatedCounts {
  _id: null;
  requestCount: number;
  errorCount: number;
}

interface AggregatedPoint {
  _id: Date;
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
      },
      { $set: bucket },
      { upsert: true },
    );
  }

  async sumSince(start: Date, end: Date): Promise<MetricCounts> {
    const [counts] = await this.model.aggregate<AggregatedCounts>([
      {
        $match: {
          bucketStart: { $gte: start, $lt: end },
        },
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
  ): Promise<MetricPoint[]> {
    const points = await this.model.aggregate<AggregatedPoint>([
      {
        $match: {
          bucketStart: { $gte: start, $lt: end },
        },
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
    ]);

    return points.map((point) => ({
      start: point._id,
      requestCount: point.requestCount,
      errorCount: point.errorCount,
    }));
  }

  async findLastCollectedAt(): Promise<Date | null> {
    const metric = await this.model
      .findOne()
      .sort({ bucketStart: -1 })
      .select({ bucketStart: 1, _id: 0 })
      .lean();

    return metric?.bucketStart ?? null;
  }
}
