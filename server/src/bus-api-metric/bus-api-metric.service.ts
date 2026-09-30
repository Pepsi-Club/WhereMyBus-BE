import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusApiMetricRepository } from './bus-api-metric.repository';

type MutableBucket = {
  requestCount: number;
  errorCount: number;
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
  private flushRunning = false;

  constructor(
    private readonly repository: BusApiMetricRepository,
    configService: ConfigService,
  ) {
    this.instanceId =
      configService.get<string>('NODE_APP_INSTANCE') ?? 'standalone';
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
    await this.flushBefore(this.minuteStart(now));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flushBefore(Number.POSITIVE_INFINITY);
  }

  private bucketFor(at: Date): MutableBucket {
    const key = this.minuteStart(at);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { requestCount: 0, errorCount: 0 };
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

  private async flushBefore(cutoff: number): Promise<void> {
    if (this.flushRunning) {
      return;
    }

    this.flushRunning = true;
    try {
      const keys = [...this.buckets.keys()]
        .filter((key) => key < cutoff)
        .sort((left, right) => left - right);

      for (const key of keys) {
        const bucket = this.buckets.get(key);
        if (!bucket) {
          continue;
        }
        if (bucket.requestCount === 0) {
          this.buckets.delete(key);
          continue;
        }

        try {
          await this.repository.upsertBucket({
            bucketStart: new Date(key),
            instanceId: this.instanceId,
            requestCount: bucket.requestCount,
            errorCount: bucket.errorCount,
            expiresAt: new Date(key + this.retentionDays * DAY_MS),
          });
          this.buckets.delete(key);
        } catch (error) {
          this.logger.error(
            `Failed to flush bus API metric bucket: ${new Date(
              key,
            ).toISOString()}`,
          );
        }
      }
    } finally {
      this.flushRunning = false;
    }
  }
}
