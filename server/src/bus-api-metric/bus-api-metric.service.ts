import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { BusApiMetricRepository } from './bus-api-metric.repository';

type MutableBucket = {
  requestCount: number;
  errorCount: number;
  flushedRequestCount: number;
  flushedErrorCount: number;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 400;
const MAX_PENDING_BUCKETS = 60;

@Injectable()
export class BusApiMetricService implements OnApplicationShutdown {
  private readonly logger = new Logger(BusApiMetricService.name);
  private readonly buckets = new Map<number, MutableBucket>();
  private readonly instanceId: string;
  private readonly retentionDays: number;
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: BusApiMetricRepository,
    configService: ConfigService,
  ) {
    const workerId =
      configService.get<string>('NODE_APP_INSTANCE') ?? 'standalone';
    this.instanceId = `${workerId}:${process.pid}:${randomUUID()}`;
    const retentionDays = Number(
      configService.get<string>(
        'BUS_API_METRIC_RETENTION_DAYS',
        String(DEFAULT_RETENTION_DAYS),
      ),
    );
    this.retentionDays =
      Number.isFinite(retentionDays) && retentionDays > 0
        ? retentionDays
        : DEFAULT_RETENTION_DAYS;
  }

  recordRequest(at = new Date()): void {
    try {
      this.bucketFor(at).requestCount += 1;
      this.trimPendingBuckets();
    } catch (error) {
      this.logger.error('Failed to record bus API request metric');
    }
  }

  recordError(at = new Date()): void {
    try {
      this.bucketFor(at).errorCount += 1;
      this.trimPendingBuckets();
    } catch (error) {
      this.logger.error('Failed to record bus API error metric');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async flushCompletedBuckets(now = new Date()): Promise<void> {
    await this.enqueueFlush(this.minuteStart(now));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.enqueueFlush(Number.POSITIVE_INFINITY);
  }

  private bucketFor(at: Date): MutableBucket {
    const key = this.minuteStart(at);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        requestCount: 0,
        errorCount: 0,
        flushedRequestCount: 0,
        flushedErrorCount: 0,
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private minuteStart(at: Date): number {
    return Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
  }

  private trimPendingBuckets(): void {
    const sortedKeys = [...this.buckets.keys()].sort(
      (left, right) => left - right,
    );
    while (sortedKeys.length > MAX_PENDING_BUCKETS) {
      const droppedKey = sortedKeys.shift();
      this.buckets.delete(droppedKey);
      this.logger.error(
        `Dropped oldest bus API metric bucket: ${new Date(
          droppedKey,
        ).toISOString()}`,
      );
    }
  }

  private enqueueFlush(cutoff: number): Promise<void> {
    const flush = this.flushQueue.then(() => this.flushBefore(cutoff));
    this.flushQueue = flush.catch(() => undefined);
    return flush;
  }

  private async flushBefore(cutoff: number): Promise<void> {
    const keys = [...this.buckets.keys()]
      .filter((key) => key < cutoff)
      .sort((left, right) => left - right);

    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (!bucket || bucket.requestCount === 0) {
        continue;
      }
      if (
        bucket.requestCount === bucket.flushedRequestCount &&
        bucket.errorCount === bucket.flushedErrorCount
      ) {
        continue;
      }

      const requestCount = bucket.requestCount;
      const errorCount = bucket.errorCount;
      try {
        await this.repository.upsertBucket({
          bucketStart: new Date(key),
          instanceId: this.instanceId,
          requestCount,
          errorCount,
          expiresAt: new Date(key + this.retentionDays * DAY_MS),
        });
        bucket.flushedRequestCount = requestCount;
        bucket.flushedErrorCount = errorCount;
      } catch (error) {
        this.logger.error(
          `Failed to flush bus API metric bucket: ${new Date(
            key,
          ).toISOString()}`,
        );
      }
    }
  }
}
