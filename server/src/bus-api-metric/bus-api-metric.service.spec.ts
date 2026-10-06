import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { BusApiMetricRepository } from './bus-api-metric.repository';
import { BusApiMetricService } from './bus-api-metric.service';
import { StoredMetricBucket } from './bus-api-metric.repository';
import { SEOUL_BUS_ARRIVAL_METRIC } from './bus-api-metric.dimension';
import axios from 'axios';
import { BusInfoService } from '../bus-info/bus-info.service';

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
        saved.instanceId === copy.instanceId &&
        saved.provider === copy.provider &&
        saved.operation === copy.operation,
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
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('호출 없는 minute는 저장하지 않는다', async () => {
    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));
    expect(repository.saved).toEqual([]);
  });

  it('같은 minute 요청과 오류를 하나의 bucket으로 저장한다', async () => {
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:10.000Z'),
    );
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:50.000Z'),
    );
    service.recordError(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:10.000Z'),
    );

    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

    expect(repository.saved[0]).toMatchObject({
      provider: 'seoul-bus',
      operation: 'bus-arrival',
      bucketStart: new Date('2026-09-30T00:00:00.000Z'),
      requestCount: 2,
      errorCount: 1,
      expiresAt: new Date('2027-11-04T00:00:00.000Z'),
    });
    expect(repository.saved[0].instanceId).toMatch(/^0:/);
  });

  it('같은 minute의 provider와 operation별 요청 및 오류를 분리한다', async () => {
    const startedAt = new Date('2026-10-05T00:00:10.000Z');
    const routeInfo = { provider: 'seoul-bus', operation: 'route-info' };
    const otherProvider = { provider: 'other-bus', operation: 'bus-arrival' };
    service.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, startedAt);
    service.recordRequest(routeInfo, startedAt);
    service.recordRequest(routeInfo, startedAt);
    service.recordError(routeInfo, startedAt);
    service.recordRequest(otherProvider, startedAt);

    await service.flushCompletedBuckets(new Date('2026-10-05T00:01:00.000Z'));

    expect(repository.saved).toHaveLength(3);
    expect(repository.saved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'seoul-bus',
          operation: 'bus-arrival',
          requestCount: 1,
          errorCount: 0,
        }),
        expect.objectContaining({
          provider: 'seoul-bus',
          operation: 'route-info',
          requestCount: 2,
          errorCount: 1,
        }),
        expect.objectContaining({
          provider: 'other-bus',
          operation: 'bus-arrival',
          requestCount: 1,
          errorCount: 0,
        }),
      ]),
    );
    expect(
      repository.saved.every(
        ({ bucketStart }) =>
          bucketStart.toISOString() === '2026-10-05T00:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('실패한 write는 다음 flush에서 같은 값으로 재시도한다', async () => {
    repository.failuresRemaining = 1;
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:10.000Z'),
    );

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
      service.recordRequest(
        SEOUL_BUS_ARRIVAL_METRIC,
        new Date(firstMinute + minute * 60_000),
      );
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
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('저장된 오래된 bucket을 제거할 때 유실 오류를 기록하지 않는다', async () => {
    const firstMinute = Date.parse('2026-09-30T00:00:00.000Z');
    for (let minute = 0; minute < 60; minute += 1) {
      service.recordRequest(
        SEOUL_BUS_ARRIVAL_METRIC,
        new Date(firstMinute + minute * 60_000),
      );
    }
    await service.flushCompletedBuckets(new Date(firstMinute + 60 * 60_000));
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date(firstMinute + 60 * 60_000),
    );
    await service.flushCompletedBuckets(new Date(firstMinute + 61 * 60_000));
    expect(repository.saved).toHaveLength(61);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('shutdown은 현재 minute의 남은 요청을 저장한다', async () => {
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:30.000Z'),
    );

    await service.beforeApplicationShutdown();

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]).toMatchObject({
      bucketStart: new Date('2026-09-30T00:00:00.000Z'),
      requestCount: 1,
      errorCount: 0,
    });
  });

  const busInfo = (metrics: BusApiMetricService) =>
    new BusInfoService(
      new ConfigService({ BUS_INFO_API: 'https://example.test/bus' }),
      metrics,
    );

  it('최종 write 중 BusInfo catch가 기록한 지연 오류까지 shutdown에 저장한다', async () => {
    let rejectRequest: (error: Error) => void;
    jest.spyOn(axios, 'get').mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    const failure = new Error('delayed upstream failure');
    const request = busInfo(service).arriveStation('22285');
    const failed = expect(request).rejects.toBe(failure);
    const gate = repository.blockNextWrite();
    const shutdown = service.beforeApplicationShutdown();
    await gate.started;
    rejectRequest(failure);
    await failed;
    gate.release();
    await shutdown;

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 1,
    });
  });

  it('첫 최종 write가 끝나도 종료 전에 받은 BusInfo 요청의 catch를 기다린다', async () => {
    let rejectRequest: (error: Error) => void;
    jest.spyOn(axios, 'get').mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    const failure = new Error('later upstream failure');
    const failed = expect(busInfo(service).arriveStation('22285')).rejects.toBe(
      failure,
    );
    let finished = false;
    const shutdown = service.beforeApplicationShutdown().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    const finishedBeforeRequest = finished;
    rejectRequest(failure);
    await failed;
    await shutdown;

    expect(finishedBeforeRequest).toBe(false);
    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 1,
    });
  });

  it('최종 write 중 새로 생긴 bucket도 안정된 마지막 drain에 저장한다', async () => {
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-10-05T00:00:10Z'),
    );
    const gate = repository.blockNextWrite();
    const shutdown = service.beforeApplicationShutdown();
    await gate.started;
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-10-05T00:01:10Z'),
    );
    const finalGate = repository.blockNextWrite();
    gate.release();
    await finalGate.started;
    service.recordRequest(
      { provider: 'other-bus', operation: 'bus-arrival' },
      new Date('2026-10-05T00:01:10Z'),
    );
    finalGate.release();
    await shutdown;

    expect(repository.saved.map(({ requestCount }) => requestCount)).toEqual([
      1, 1, 1,
    ]);
  });

  it('종료 시작 후 새 BusInfo 호출은 정상 응답하지만 metric producer를 추가하지 않는다', async () => {
    const data = { msgHeader: { headerCd: '0' }, msgBody: { itemList: [] } };
    jest.spyOn(axios, 'get').mockResolvedValue({ data });
    service.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, new Date());
    const gate = repository.blockNextWrite();
    const shutdown = service.beforeApplicationShutdown();
    await gate.started;
    await expect(busInfo(service).arriveStation('22285')).resolves.toBe(data);
    gate.release();
    await shutdown;
    await service.flushCompletedBuckets(new Date(Date.now() + 60_000));

    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 0,
    });
  });

  it('settle하지 않는 BusInfo producer도 5초 종료 예산을 넘기지 않는다', async () => {
    // Installed Jest 28 accepts options, while the retained Jest 27 types do not.
    jest.useFakeTimers({ legacyFakeTimers: true } as unknown as 'legacy');
    jest.spyOn(axios, 'get').mockReturnValue(new Promise(() => undefined));
    void busInfo(service).arriveStation('22285');
    let finished = false;
    const shutdown = service.beforeApplicationShutdown().then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const finishedBeforeDeadline = finished;
    jest.advanceTimersByTime(5_000);
    await shutdown;

    expect(finishedBeforeDeadline).toBe(false);
    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 0,
    });
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('shutdown deadline'),
    );
  });

  it('멈춘 최종 write도 5초 후 종료하고 해제된 write 뒤 추가 저장을 시작하지 않는다', async () => {
    jest.useFakeTimers({ legacyFakeTimers: true } as unknown as 'legacy');
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-10-05T00:00:10Z'),
    );
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-10-05T00:01:10Z'),
    );
    const gate = repository.blockNextWrite();
    const shutdown = service.beforeApplicationShutdown();
    await gate.started;
    jest.advanceTimersByTime(5_000);
    await shutdown;
    expect(repository.saved).toEqual([]);
    gate.release();
    await service.flushCompletedBuckets(new Date('2026-10-05T00:02:00Z'));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].bucketStart).toEqual(
      new Date('2026-10-05T00:00:00Z'),
    );
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('shutdown deadline'),
    );
  });

  it('종료 예산 이후의 upstream 오류는 원래 오류를 유지하고 닫힌 metric을 변경하지 않는다', async () => {
    jest.useFakeTimers({ legacyFakeTimers: true } as unknown as 'legacy');
    let rejectRequest: (error: Error) => void;
    jest.spyOn(axios, 'get').mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    const failure = new Error('after deadline');
    const request = busInfo(service).arriveStation('22285');
    const failed = expect(request).rejects.toBe(failure);
    const gate = repository.blockNextWrite();
    const shutdown = service.beforeApplicationShutdown();
    await gate.started;
    gate.release();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(5_000);
    await shutdown;
    rejectRequest(failure);
    await failed;
    await service.flushCompletedBuckets(new Date(Date.now() + 60_000));

    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 0,
    });
  });

  it('flush write 중 추가된 오류를 다음 flush에서 누적 저장한다', async () => {
    const startedAt = new Date('2026-09-30T00:00:59.900Z');
    service.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, startedAt);
    const gate = repository.blockNextWrite();

    const firstFlush = service.flushCompletedBuckets(
      new Date('2026-09-30T00:01:00.000Z'),
    );
    await gate.started;
    service.recordError(SEOUL_BUS_ARRIVAL_METRIC, startedAt);
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
    service.recordRequest(SEOUL_BUS_ARRIVAL_METRIC, startedAt);
    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

    service.recordError(SEOUL_BUS_ARRIVAL_METRIC, startedAt);
    await service.flushCompletedBuckets(new Date('2026-09-30T00:02:00.000Z'));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]).toMatchObject({
      requestCount: 1,
      errorCount: 1,
    });
  });

  it('진행 중인 flush를 기다린 뒤 shutdown 시 현재 minute까지 저장한다', async () => {
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:30.000Z'),
    );
    const gate = repository.blockNextWrite();
    const regularFlush = service.flushCompletedBuckets(
      new Date('2026-09-30T00:01:00.000Z'),
    );
    await gate.started;
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:01:10.000Z'),
    );

    const shutdown = service.beforeApplicationShutdown();
    gate.release();
    await Promise.all([regularFlush, shutdown]);

    expect(repository.saved).toHaveLength(2);
    expect(repository.saved.map(({ requestCount }) => requestCount)).toEqual([
      1, 1,
    ]);
  });

  it('같은 worker가 같은 minute에 재시작해도 이전 count를 덮어쓰지 않는다', async () => {
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:10.000Z'),
    );
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:20.000Z'),
    );
    await service.beforeApplicationShutdown();

    const restartedService = new BusApiMetricService(
      repository as unknown as BusApiMetricRepository,
      new ConfigService({
        NODE_APP_INSTANCE: '0',
        BUS_API_METRIC_RETENTION_DAYS: '400',
      }),
    );
    restartedService.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:40.000Z'),
    );
    await restartedService.beforeApplicationShutdown();

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
    service.recordRequest(
      SEOUL_BUS_ARRIVAL_METRIC,
      new Date('2026-09-30T00:00:10.000Z'),
    );

    await service.flushCompletedBuckets(new Date('2026-09-30T00:01:00.000Z'));

    expect(repository.saved[0].instanceId).toMatch(/^standalone:/);
  });
});
