import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { BusApiMetricRepository } from './bus-api-metric.repository';
import {
  BUS_API_METRIC_DIMENSIONS,
  BusApiMetricIdentity,
} from './bus-api-metric.dimension';

type MutableBucket = BusApiMetricIdentity & {
  bucketStart: number;
  requestCount: number;
  errorCount: number;
  flushedRequestCount: number;
  flushedErrorCount: number;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 400;
const MAX_PENDING_BUCKETS_PER_DIMENSION = 60;
const SHUTDOWN_TIMEOUT_MS = 5_000;

@Injectable()
export class BusApiMetricService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BusApiMetricService.name);
  private readonly buckets = new Map<string, MutableBucket>();
  private readonly instanceId: string;
  private readonly retentionDays: number;
  private flushQueue: Promise<void> = Promise.resolve();
  private shutdown?: Promise<void>;
  private closed = false;
  private activeRequests = 0;
  private producersIdle?: () => void;
  private revision = 0;

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

  recordRequest(identity: BusApiMetricIdentity, at = new Date()): void {
    if (this.closed) return;
    try {
      this.bucketFor(identity, at).requestCount += 1;
      this.revision += 1;
      this.trimPendingBuckets();
    } catch (error) {
      this.logger.error('Failed to record bus API request metric');
    }
  }

  recordError(identity: BusApiMetricIdentity, at = new Date()): void {
    if (this.closed) return;
    try {
      this.bucketFor(identity, at).errorCount += 1;
      this.revision += 1;
      this.trimPendingBuckets();
    } catch (error) {
      this.logger.error('Failed to record bus API error metric');
    }
  }

  startRequest(
    identity: BusApiMetricIdentity,
    at = new Date(),
  ): (() => void) | undefined {
    if (this.shutdown || this.closed) return undefined;
    this.recordRequest(identity, at);
    this.activeRequests += 1;
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      this.activeRequests -= 1;
      if (this.activeRequests === 0) this.producersIdle?.();
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async flushCompletedBuckets(now = new Date()): Promise<void> {
    await this.enqueueFlush(this.minuteStart(now));
  }

  beforeApplicationShutdown(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.closed = true;
        this.producersIdle?.();
        this.logger.error(
          'Bus API metric shutdown deadline exceeded; pending metrics may be lost',
        );
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
    });
    this.shutdown = Promise.race([this.drainShutdown(), deadline]).finally(
      () => {
        clearTimeout(timer);
        this.closed = true;
        this.producersIdle = undefined;
      },
    );
    return this.shutdown;
  }

  private async drainShutdown(): Promise<void> {
    // Persist counts already available even if an upstream request never settles.
    await this.enqueueFlush(Number.POSITIVE_INFINITY);
    if (this.activeRequests > 0 && !this.closed) {
      await new Promise<void>((resolve) => {
        this.producersIdle = resolve;
      });
    }
    while (!this.closed) {
      const revision = this.revision;
      await this.enqueueFlush(Number.POSITIVE_INFINITY);
      if (revision === this.revision) {
        this.closed = true;
        return;
      }
    }
  }

  private bucketFor(identity: BusApiMetricIdentity, at: Date): MutableBucket {
    const bucketStart = this.minuteStart(at);
    const key = this.bucketKey(identity, bucketStart);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        provider: identity.provider,
        operation: identity.operation,
        bucketStart,
        requestCount: 0,
        errorCount: 0,
        flushedRequestCount: 0,
        flushedErrorCount: 0,
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private bucketKey(identity: BusApiMetricIdentity, minute: number): string {
    return `${minute}\u0000${identity.provider}\u0000${identity.operation}`;
  }

  private minuteStart(at: Date): number {
    return Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
  }

  private trimPendingBuckets(): void {
    const sortedEntries = [...this.buckets.entries()].sort(
      ([, left], [, right]) => left.bucketStart - right.bucketStart,
    );
    const maxPendingBuckets =
      MAX_PENDING_BUCKETS_PER_DIMENSION * BUS_API_METRIC_DIMENSIONS.length;
    while (sortedEntries.length > maxPendingBuckets) {
      const [droppedKey, bucket] = sortedEntries.shift();
      this.buckets.delete(droppedKey);
      if (
        bucket.requestCount !== bucket.flushedRequestCount ||
        bucket.errorCount !== bucket.flushedErrorCount
      ) {
        this.logger.error(
          `Dropped oldest bus API metric bucket: ${new Date(
            bucket.bucketStart,
          ).toISOString()}`,
        );
      }
    }
  }

  private enqueueFlush(cutoff: number): Promise<void> {
    const flush = this.flushQueue.then(() => this.flushBefore(cutoff));
    this.flushQueue = flush.catch(() => undefined);
    return flush;
  }

  private async flushBefore(cutoff: number): Promise<void> {
    const keys = [...this.buckets.entries()]
      .filter(([, bucket]) => bucket.bucketStart < cutoff)
      .sort(([, left], [, right]) => left.bucketStart - right.bucketStart)
      .map(([key]) => key);

    for (const key of keys) {
      if (this.closed) return;
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
          provider: bucket.provider,
          operation: bucket.operation,
          bucketStart: new Date(bucket.bucketStart),
          instanceId: this.instanceId,
          requestCount,
          errorCount,
          expiresAt: new Date(bucket.bucketStart + this.retentionDays * DAY_MS),
        });
        bucket.flushedRequestCount = requestCount;
        bucket.flushedErrorCount = errorCount;
      } catch (error) {
        this.logger.error(
          `Failed to flush bus API metric bucket: ${new Date(
            bucket.bucketStart,
          ).toISOString()}`,
        );
      }
    }
  }
}
