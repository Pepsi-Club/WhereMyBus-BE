import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { BusApiMetricRepository } from './bus-api-metric.repository';
import { BusApiMetricService } from './bus-api-metric.service';
import { StoredMetricBucket } from './bus-api-metric.repository';

class InMemoryMetricRepository {
  saved: StoredMetricBucket[] = [];
  failuresRemaining = 0;
  private nextWriteGate?: {
    markStarted: () => void;
    wait: Promise<void>;
  };

  blockNextWrite(): { started: Promise<void>; release: () => void } {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextWriteGate = { markStarted, wait };
    return { started, release };
  }

  async upsertBucket(bucket: StoredMetricBucket): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('mongo unavailable');
    }

    const copy = { ...bucket };
    const gate = this.nextWriteGate;
    this.nextWriteGate = undefined;
    if (gate) {
      gate.markStarted();
      await gate.wait;
    }

    const index = this.saved.findIndex(
      (saved) =>
        saved.bucketStart.getTime() === copy.bucketStart.getTime() &&
        saved.instanceId === copy.instanceId,
    );
    if (index >= 0) {
      this.saved[index] = copy;
      return;
    }
    this.saved.push(copy);
  }
}

describe('BusApiMetricService', () => {
  let repository: InMemoryMetricRepository;
  let service: BusApiMetricService;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    repository = new InMemoryMetricRepository();
    const config = new ConfigService({
      NODE_APP_INSTANCE: '0',
      BUS_API_METRIC_RETENTION_DAYS: '400',
    });
    service = new BusApiMetricService(
      repository as unknown as BusApiMetricRepository,
      config,
    );
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  it('호출 없는 minute는 저장하지 않는다', async () => {
    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));
    expect(repository.saved).toEqual([]);
  });

  it('같은 minute 요청과 오류를 하나의 bucket으로 저장한다', async () => {
    service.recordRequest(new Date('2026-09-30T00:00:10.000Z'));
    service.recordRequest(new Date('2026-09-30T00:00:50.000Z'));
    service.recordError(new Date('2026-09-30T00:00:10.000Z'));

    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

    expect(repository.saved[0]).toMatchObject({
      bucketStart: new Date('2026-09-30T00:00:00.000Z'),
      requestCount: 2,
      errorCount: 1,
      expiresAt: new Date('2027-11-04T00:00:00.000Z'),
    });
    expect(repository.saved[0].instanceId).toMatch(/^0:/);
  });

  it('실패한 write는 다음 flush에서 같은 값으로 재시도한다', async () => {
    repository.failuresRemaining = 1;
    service.recordRequest(new Date('2026-09-30T00:00:10.000Z'));

    await expect(
      service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z')),
    ).resolves.toBeUndefined();
    expect(repository.saved).toEqual([]);

    await service.flushCompletedBuckets(new Date('2026-09-30T00:02:00.000Z'));
    await service.flushCompletedBuckets(new Date('2026-09-30T00:03:00.000Z'));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].requestCount).toBe(1);
  });

  it('pending bucket 61개가 되면 가장 오래된 bucket만 제거한다', async () => {
    const firstMinute = new Date('2026-09-30T00:00:00.000Z').getTime();
    for (let minute = 0; minute < 61; minute += 1) {
      service.recordRequest(new Date(firstMinute + minute * 60_000));
    }

    await service.flushCompletedBuckets(new Date(firstMinute + 62 * 60_000));

    expect(repository.saved).toHaveLength(60);
    expect(repository.saved[0].bucketStart).toEqual(
      new Date('2026-09-30T00:01:00.000Z'),
    );
    expect(
      repository.saved.some(
        ({ bucketStart }) => bucketStart.getTime() === firstMinute,
      ),
    ).toBe(false);
  });

  it('shutdown은 현재 minute의 남은 요청을 저장한다', async () => {
    service.recordRequest(new Date('2026-09-30T00:00:30.000Z'));

    await service.onApplicationShutdown();

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]).toMatchObject({
      bucketStart: new Date('2026-09-30T00:00:00.000Z'),
      requestCount: 1,
      errorCount: 0,
    });
  });

  it('flush write 중 추가된 오류를 다음 flush에서 누적 저장한다', async () => {
    const startedAt = new Date('2026-09-30T00:00:59.900Z');
    service.recordRequest(startedAt);
    const gate = repository.blockNextWrite();

    const firstFlush = service.flushCompletedBuckets(
      new Date('2026-09-30T00:01:00.000Z'),
    );
    await gate.started;
    service.recordError(startedAt);
    gate.release();
    await firstFlush;
    await service.flushCompletedBuckets(new Date('2026-09-30T00:02:00.000Z'));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 1,
    });
  });

  it('이미 flush된 minute의 지연 오류도 기존 요청 수에 누적한다', async () => {
    const startedAt = new Date('2026-09-30T00:00:59.900Z');
    service.recordRequest(startedAt);
    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

    service.recordError(startedAt);
    await service.flushCompletedBuckets(new Date('2026-09-30T00:02:00.000Z'));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 1,
    });
  });

  it('진행 중인 flush를 기다린 뒤 shutdown 시 현재 minute까지 저장한다', async () => {
    service.recordRequest(new Date('2026-09-30T00:00:30.000Z'));
    const gate = repository.blockNextWrite();
    const regularFlush = service.flushCompletedBuckets(
      new Date('2026-09-30T00:01:00.000Z'),
    );
    await gate.started;
    service.recordRequest(new Date('2026-09-30T00:01:10.000Z'));

    const shutdown = service.onApplicationShutdown();
    gate.release();
    await Promise.all([regularFlush, shutdown]);

    expect(repository.saved).toHaveLength(2);
    expect(repository.saved.map(({ requestCount }) => requestCount)).toEqual([
      1, 1,
    ]);
  });

  it('같은 worker가 같은 minute에 재시작해도 이전 count를 덮어쓰지 않는다', async () => {
    service.recordRequest(new Date('2026-09-30T00:00:10.000Z'));
    service.recordRequest(new Date('2026-09-30T00:00:20.000Z'));
    await service.onApplicationShutdown();

    const restartedService = new BusApiMetricService(
      repository as unknown as BusApiMetricRepository,
      new ConfigService({
        NODE_APP_INSTANCE: '0',
        BUS_API_METRIC_RETENTION_DAYS: '400',
      }),
    );
    restartedService.recordRequest(new Date('2026-09-30T00:00:40.000Z'));
    await restartedService.onApplicationShutdown();

    expect(
      repository.saved.reduce(
        (total, { requestCount }) => total + requestCount,
        0,
      ),
    ).toBe(3);
  });

  it('NODE_APP_INSTANCE가 없으면 standalone으로 저장한다', async () => {
    service = new BusApiMetricService(
      repository as unknown as BusApiMetricRepository,
      new ConfigService({ BUS_API_METRIC_RETENTION_DAYS: '400' }),
    );
    service.recordRequest(new Date('2026-09-30T00:00:10.000Z'));

    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

    expect(repository.saved[0].instanceId).toMatch(/^standalone:/);
  });
});
